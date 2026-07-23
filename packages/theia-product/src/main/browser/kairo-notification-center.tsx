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
}

function categoryIcon(category: NotificationCategory): string {
  switch (category) {
    case 'error': return '$(error)';
    case 'warning': return '$(warning)';
    case 'info': return '$(info)';
    default: return '$(info)';
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

const NotificationCenter: React.FC<NotificationCenterProps> = ({ service }) => {
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
  };

  return (
    <div className="kairo-notification-center">
      <div className="kairo-notification-header">
        <span className="kairo-notification-title">Notifications</span>
        <div className="kairo-notification-header-actions">
          {history.length > 0 && (
            <button
              className="theia-button kairo-notification-clear-all"
              onClick={() => service.clearAll()}
              title="Clear all notifications"
            >
              Clear All
            </button>
          )}
        </div>
      </div>
      <div className="kairo-notification-list">
        {history.length === 0 ? (
          <p className="kairo-notification-empty">No notifications.</p>
        ) : (
          history.map(n => (
            <div
              key={n.id}
              className={`kairo-notification-item ${categoryClass(n.category)} ${n.read ? 'kairo-notif-read' : 'kairo-notif-unread'}`}
            >
              <div
                className="kairo-notification-summary"
                onClick={() => { toggleExpand(n.id); if (!n.read) { n.read = true; setHistory([...service.getHistory()]); } }}
                role="button"
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter') { toggleExpand(n.id); if (!n.read) { n.read = true; setHistory([...service.getHistory()]); } } }}
              >
                <span className="kairo-notification-icon">{categoryIcon(n.category)}</span>
                <span className="kairo-notification-message">{n.message}</span>
                <span className="kairo-notification-time">{formatTime(n.timestamp)}</span>
                <button
                  className="kairo-notification-dismiss"
                  onClick={e => { e.stopPropagation(); service.clear(n.id); }}
                  title="Dismiss"
                >
                  ×
                </button>
              </div>
              {expanded.has(n.id) && n.details && (
                <div className="kairo-notification-details">
                  <pre className="kairo-notification-details-text">{n.details}</pre>
                </div>
              )}
            </div>
          ))
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

  constructor() {
    super();
    this.id = KAIRO_NOTIFICATION_CENTER_FACTORY_ID;
    this.title.label = 'Notifications';
    this.title.caption = 'Kairo Notification Center';
    this.title.iconClass = 'codicon codicon-bell';
    this.title.closable = true;
    this.addClass('kairo-widget');
  }

  render(): React.ReactNode {
    return React.createElement(NotificationCenter, {
      service: this.notificationService,
      widgetManager: this.widgetManager,
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
    this.statusBar.setElement('kairo.notifications', {
      text: `$(bell)${badge}`,
      tooltip: unread > 0
        ? `${unread} unread notification${unread > 1 ? 's' : ''}. Click to open.`
        : 'No notifications. Click to open.',
      alignment: StatusBarAlignment.RIGHT,
      priority: 50,
      command: KairoNotificationCommands.TOGGLE.id,
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