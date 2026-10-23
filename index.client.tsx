import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { TicketsScreen } from "./client/screen";

function TicketsItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return <SidebarRow icon="CircleDot" active={currentScreen?.screenId === "tickets-dispatcher"} onPress={() => openScreen({ screenId: "tickets-dispatcher" })} />;
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "tickets-dispatcher", title: "Tickets Dispatcher", Component: TicketsScreen });
  client.addSidebarHeaderItem({ id: "tickets-dispatcher", title: "Tickets Dispatcher", Component: TicketsItem });
  return () => {};
}
