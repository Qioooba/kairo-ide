/**
 * Kairo Notification Center — aggregated notification management
 * with a status bar bell icon and expandable notification history.
 *
 * P2-UX-03:
 *   - Aggregate notifications instead of toast spam
 *   - Categories: Info / Warning / Error
 *   - Each notification: expandable details
 *   - Notification history: last 50 items, clearable
 *   - Bell icon in status bar with unread count badge
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import {
  StatusBar,
  StatusBarAlignment,
  WidgetManager,
  FrontendApplicationContribution,
  FrontendApplication,
  ApplicationShell,
} from '@theia/core/lib/browser';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { Command, CommandContribution, CommandRegistry, Disposable } from '@theia/core/lib/common';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { KairoI18nService, type KairoI18nKey } from '@kairo/i18n';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export type NotificationCategory = 'info' | 'warning' | 'error';

export interface KairoNotification {
  id: string;
  message: string;
  category: NotificationCategory;
  details?: string;
  timestamp: number;
  read: boolean;
}

/* ------------------------------------------------------------------ */
/*  Service                                                             */
/* ------------------------------------------------------------------ */

export const KairoNotificationService = Symbol('KairoNotificationService');

@injectable()
export class KairoNotificationServiceImpl {
  protected readonly _onDidChange = new Emitter<void>();
  readonly onDidChange: Event<void> = this._onDidChange.event;

  protected notifications: KairoNotification[] = [];
  protected maxHistory = 50;
  private nextId = 1;

  /** Add a notification and notify listeners. */
  notify(message: string, category: NotificationCategory, details?: string): string {
    const id = `kairo-notif-${this.nextId++}`;
    const notification: KairoNotification = {
      id,
      message,
      category,
      details,
      timestamp: Date.now(),
      read: false,
    };
    this.notifications.unshift(notification);
    // Trim to max history
    if (this.notifications.length > this.maxHistory) {
      this.notifications = this.notifications.slice(0, this.maxHistory);
    }
    this._onDidChange.fire();
    return id;
  }

  /** Dismiss a single notification by id. */
  clear(id: string): void {
    this.notifications = this.notifications.filter(n => n.id !== id);
    this._onDidChange.fire();
  }

  /** Dismiss all notifications. */
  clearAll(): void {
    this.notifications = [];
    this._onDidChange.fire();
  }

  /** Mark all notifications as read. */
  markAllRead(): void {
    this.notifications.forEach(n => { n.read = true; });
    this._onDidChange.fire();
  }

  /** Mark one notification as read and publish the change (UI-14). */
  markRead(id: string): void {
    const found = this.notifications.find(n => n.id === id);
    if (found && !found.read) {
      found.read = true;
      this._onDidChange.fire();
    }
  }

  /** Get the notification history (last 50 items). */
  getHistory(): ReadonlyArray<KairoNotification> {
    return this.notifications;
  }

  /** Count of unread notifications. */
  getUnreadCount(): number {
    return this.notifications.filter(n => !n.read).length;
  }
}

/* ------------------------------------------------------------------ */
/*  React Component                                                     */
/* ------------------------------------------------------------------ */

interface NotificationCenterProps {
  service: KairoNotificationServiceImpl;
  widgetManager: WidgetManager;
  i18n: KairoI18nService;
}

function categoryIconClass(category: NotificationCategory): string {
  switch (category) {
    case 'error': return 'codicon-error';
    case 'warning': return 'codicon-warning';
    case 'info': return 'codicon-info';
    default: return 'codicon-info';
  }
}

function categoryClass(category: NotificationCategory): string {
  switch (category) {
    case 'error': return 'kairo-notif-cat-error';
    case 'warning': return 'kairo-notif-cat-warning';
    case 'info': return 'kairo-notif-cat-info';
    default: return 'kairo-notif-cat-info';
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const NotificationCenter: React.FC<NotificationCenterProps> = ({ service, i18n }) => {
  const t = React.useCallback((key: string, params?: Record<string, string | number>) => i18n.t(key as any, params), [i18n]);
  const [, forceUpdate] = React.useReducer(x => x + 1, 0);

  React.useEffect(() => {
    const disposable = i18n.onDidChangeLanguage(() => forceUpdate());
    return () => disposable.dispose();
  }, [i18n]);

  const [history, setHistory] = React.useState<ReadonlyArray<KairoNotification>>([]);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    const update = () => setHistory([...service.getHistory()]);
    update();
    const disposable = service.onDidChange(() => update());
    return () => disposable.dispose();
  }, [service]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    // Reading state goes through the service so every listener (badge,
    // status bar, list) observes the same change event (UI-14).
    service.markRead(id);
  };

  return (
    <div className="kairo-notification-center">
      <div className="kairo-notification-header">
        <span className="kairo-notification-title">{t('widget.notification.title')}</span>
        <div className="kairo-notification-header-actions">
          {history.length > 0 && (
            <button
              className="theia-button kairo-notification-clear-all"
              onClick={() => service.clearAll()}
              title={t('widget.notification.clearAllAria')}
            >
              {t('widget.notification.clearAll')}
            </button>
          )}
        </div>
      </div>
      <div className="kairo-notification-list" role="list" aria-label={t('widget.notification.title')}>
        {history.length === 0 ? (
          <p className="kairo-notification-empty">{t('widget.notification.empty')}</p>
        ) : (
          history.map(n => {
            // UI-14: expand and dismiss are sibling native buttons — no nested
            // interactive elements, no div[role=button]. Only notifications
            // with details are expandable; plain ones render no toggle.
            const expandable = Boolean(n.details);
            const expandedNow = expanded.has(n.id);
            const detailsId = `kairo-notif-details-${n.id}`;
            return (
              <div
                key={n.id}
                role="listitem"
                className={`kairo-notification-item ${categoryClass(n.category)} ${n.read ? 'kairo-notif-read' : 'kairo-notif-unread'}`}
              >
                <div className="kairo-notification-summary">
                  <span className={`codicon ${categoryIconClass(n.category)} kairo-notification-icon`} aria-hidden="true" />
                  <span className="kairo-notification-message">{n.message}</span>
                  <span className="kairo-notification-time">{formatTime(n.timestamp)}</span>
                  {expandable && (
                    <button
                      type="button"
                      className="kairo-notification-expand"
                      data-testid={`notif-expand-${n.id}`}
                      aria-expanded={expandedNow}
                      aria-controls={detailsId}
                      onClick={() => toggleExpand(n.id)}
                      title={t('widget.notification.toggleDetails')}
                    >
                      <span className={`codicon ${expandedNow ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    className="kairo-notification-dismiss"
                    data-testid={`notif-dismiss-${n.id}`}
                    onClick={() => service.clear(n.id)}
                    title={t('widget.notification.dismiss')}
                    aria-label={`${t('widget.notification.dismiss')}: ${n.message}`}
                  >
                    <span className="codicon codicon-close" aria-hidden="true" />
                  </button>
                </div>
                {expandable && expandedNow && (
                  <div className="kairo-notification-details" id={detailsId}>
                    <pre className="kairo-notification-details-text">{n.details}</pre>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Widget                                                              */
/* ------------------------------------------------------------------ */

export const KAIRO_NOTIFICATION_CENTER_FACTORY_ID = 'kairo-notification-center';

@injectable()
export class KairoNotificationCenterWidget extends ReactWidget {
  static readonly ID = KAIRO_NOTIFICATION_CENTER_FACTORY_ID;

  @inject(KairoNotificationServiceImpl)
  protected readonly notificationService!: KairoNotificationServiceImpl;

  @inject(WidgetManager)
  protected readonly widgetManager!: WidgetManager;

  @inject(KairoI18nService)
  protected readonly i18n!: KairoI18nService;

  constructor() {
    super();
    this.id = KAIRO_NOTIFICATION_CENTER_FACTORY_ID;
    this.title.iconClass = 'codicon codicon-bell';
    this.title.closable = true;
    this.addClass('kairo-widget');
  }

  @postConstruct()
  protected init(): void {
    this.updateTitle();
    this.toDispose.push(this.i18n.onDidChangeLanguage(() => this.updateTitle()));
  }

  protected updateTitle(): void {
    this.title.label = this.i18n.t('widget.notification.title' as KairoI18nKey);
    this.title.caption = this.i18n.t('widget.notification.caption' as KairoI18nKey);
  }

  render(): React.ReactNode {
    return React.createElement(NotificationCenter, {
      service: this.notificationService,
      widgetManager: this.widgetManager,
      i18n: this.i18n,
    });
  }
}

/* ------------------------------------------------------------------ */
/*  Status Bar & Commands                                               */
/* ------------------------------------------------------------------ */

export namespace KairoNotificationCommands {
  export const TOGGLE: Command = {
    id: 'kairo.notification.toggle',
    label: 'Kairo: Toggle Notification Center',
  };
}

@injectable()
export class KairoNotificationCenterContribution
  implements FrontendApplicationContribution, CommandContribution {

  @inject(StatusBar) protected readonly statusBar!: StatusBar;
  @inject(KairoNotificationServiceImpl)
  protected readonly service!: KairoNotificationServiceImpl;
  @inject(WidgetManager)
  protected readonly widgetManager!: WidgetManager;
  @inject(ApplicationShell)
  protected readonly shell!: ApplicationShell;
  @inject(KairoI18nService)
  protected readonly i18n!: KairoI18nService;

  protected unsubscribeNotifications: Disposable | undefined;

  @postConstruct()
  init(): void {
    this.renderStatusBarEntry();
  }

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(KairoNotificationCommands.TOGGLE, {
      execute: () => this.toggleNotificationCenter(),
    });
  }

  onStart(_app: FrontendApplication): void {
    this.unsubscribeNotifications = this.service.onDidChange(() => {
      this.renderStatusBarEntry();
    });
  }

  onStop(): void {
    this.unsubscribeNotifications?.dispose();
  }

  protected renderStatusBarEntry(): void {
    const unread = this.service.getUnreadCount();
    const badge = unread > 0 ? ` ${unread}` : '';
    const label = unread > 0
      ? this.i18n.t('widget.notification.statusUnread' as KairoI18nKey, { count: unread })
      : this.i18n.t('widget.notification.statusEmpty' as KairoI18nKey);
    this.statusBar.setElement('kairo.notifications', {
      text: `$(bell)${badge}`,
      tooltip: label,
      alignment: StatusBarAlignment.RIGHT,
      priority: 50,
      command: KairoNotificationCommands.TOGGLE.id,
      accessibilityInformation: {
        label: this.i18n.t('widget.notification.statusAria' as KairoI18nKey, { label }),
        role: 'button',
      },
    });
  }

  protected async toggleNotificationCenter(): Promise<void> {
    this.service.markAllRead();
    try {
      const widget = await this.widgetManager.getOrCreateWidget(
        KAIRO_NOTIFICATION_CENTER_FACTORY_ID,
      );
      if (widget.isVisible) {
        widget.close();
      } else {
        try {
          this.shell.addWidget(widget, { area: 'bottom' });
        } catch {
          // Already attached
        }
        this.shell.activateWidget(widget.id);
        widget.update();
      }
    } catch {
      // Widget not yet registered — no-op
    }
  }
}