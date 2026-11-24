import "server-only";

import { publicOrigin } from "@/features/public/urls";
import { WIDGET_ASSET_REVISION } from "@/features/widget/paths";

/**
 * Herald's own installation of its widget.
 *
 * The public pages can mount the same loader customers install, but only when
 * this deployment names the workspace and product it should point at and
 * supplies that product's public installation key. Anything unset means the
 * deployment has no widget of its own, so `HeraldWidgetScript` renders nothing
 * instead of shipping a snippet for a tenant that does not exist here.
 */
export type HeraldWidgetInstall = {
  /** Absolute loader URL for this deployment. */
  src: string;
  /** `workspace/product`, the pair the loader parses from `data-project`. */
  project: string;
  /** Public installation key from the product's Widget page. */
  publicKey: string;
};

export function getHeraldWidgetInstall(): HeraldWidgetInstall | null {
  const workspace = process.env.HERALD_WIDGET_WORKSPACE?.trim() ?? "";
  const product = process.env.HERALD_WIDGET_PRODUCT?.trim() ?? "";
  const publicKey = process.env.HERALD_WIDGET_KEY?.trim() ?? "";
  if (workspace === "" || product === "" || publicKey === "") return null;

  return {
    src: `${publicOrigin()}/widget/v1.js?v=${WIDGET_ASSET_REVISION}`,
    project: `${workspace}/${product}`,
    publicKey,
  };
}
