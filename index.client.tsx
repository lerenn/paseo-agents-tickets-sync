import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { TicketsScreen } from "./client/screen";

function TicketsItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return <SidebarRow icon="CircleDot" active={currentScreen?.screenId === "agent-tickets"} onPress={() => openScreen({ screenId: "agent-tickets" })} />;
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "agent-tickets", title: "Agent tickets", Component: TicketsScreen });
  client.addSidebarHeaderItem({ id: "agent-tickets", title: "Agent tickets", Component: TicketsItem });
  return () => {};
}
