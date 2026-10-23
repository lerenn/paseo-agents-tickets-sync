import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { TicketsScreen } from "./client/screen";

function TicketsItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return <SidebarRow icon="CircleDot" active={currentScreen?.screenId === "agents-tickets-sync"} onPress={() => openScreen({ screenId: "agents-tickets-sync" })} />;
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "agents-tickets-sync", title: "Agents tickets sync", Component: TicketsScreen });
  client.addSidebarHeaderItem({ id: "agents-tickets-sync", title: "Agents tickets sync", Component: TicketsItem });
  return () => {};
}
