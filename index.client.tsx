import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { LinearScreen } from "./client/screen";

function LinearItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return <SidebarRow icon="CircleDot" active={currentScreen?.screenId === "linear"} onPress={() => openScreen({ screenId: "linear" })} />;
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "linear", title: "Linear", Component: LinearScreen });
  client.addSidebarHeaderItem({ id: "linear", title: "Linear", Component: LinearItem });
  return () => {};
}
