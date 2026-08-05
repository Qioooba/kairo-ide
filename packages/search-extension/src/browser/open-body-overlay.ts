/**
 * Open a Lumino widget as a fixed overlay on document.body (IDEA-style
 * modal). Avoids docking into the main editor area as an empty tab.
 */

import { Widget } from '@theia/core/lib/browser/widgets';
import type { WidgetManager } from '@theia/core/lib/browser/widget-manager';

export async function openBodyOverlay(
  widgetManager: WidgetManager,
  widgetId: string,
): Promise<Widget> {
  const widget = await widgetManager.getOrCreateWidget(widgetId);
  if (widget.isAttached && widget.node.parentElement !== document.body) {
    Widget.detach(widget);
  }
  if (!widget.isAttached) {
    Widget.attach(widget, document.body);
  }
  widget.show();
  widget.activate();
  widget.update();
  return widget;
}
