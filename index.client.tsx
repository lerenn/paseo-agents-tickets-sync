import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { hostBadgeComponent } from "./client/host-badge";
import { TicketsScreen } from "./client/screen";

const HostBadge = hostBadgeComponent();

function TicketsItem({ currentScreen, openScreen, host }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      // `subtitle` is newer than the pinned plugin types, hence the spread.
      {...(HostBadge ? { subtitle: <HostBadge hostId={host.id} /> } : {})}
      icon="CircleDot"
      active={currentScreen?.screenId === "tickets-dispatcher"}
      onPress={() => openScreen({ screenId: "tickets-dispatcher" })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "tickets-dispatcher", title: "Tickets Dispatcher", Component: TicketsScreen });
  client.addSidebarHeaderItem({ id: "tickets-dispatcher", title: "Tickets Dispatcher", Component: TicketsItem });
  return () => {};
}
