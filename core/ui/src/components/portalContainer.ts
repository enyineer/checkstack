import * as React from "react";

/**
 * The DOM element a floating layer (e.g. a {@link PopoverContent}) should
 * portal INTO when it is rendered inside a modal Sheet/Dialog.
 *
 * Radix modal dialogs lock body scroll via `react-remove-scroll`, which
 * prevents wheel/touch scrolling on anything portaled to `document.body`
 * (i.e. outside the dialog's DOM subtree). A Popover whose list overflows
 * therefore can't scroll while a Sheet/Dialog is open. Portaling the Popover
 * INTO the dialog content keeps it inside the allowed-scroll subtree, so its
 * inner `overflow-y-auto` works again. Radix positions popovers with
 * `position: fixed`, so the container has no effect on placement or clipping.
 *
 * `null` (the default, outside any Sheet/Dialog) means portal to `body` as
 * usual.
 */
export const PortalContainerContext = React.createContext<HTMLElement | null>(
  null,
);

/** Read the nearest Sheet/Dialog content element to portal a popover into. */
export const usePortalContainer = (): HTMLElement | null =>
  React.useContext(PortalContainerContext);
