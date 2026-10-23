import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { SettingsInput } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { auditRpc, clearKeyRpc, setKeyRpc, statusRpc } from "../shared/rpc";

const STATUS_KEY = ["linear", "status"];
const AUDIT_KEY = ["linear", "audit"];

export function LinearScreen({ theme, layout }: PluginScreenProps) {
  const styles = useMemo(() => makeStyles(theme, layout.compact), [theme, layout.compact]);
  const queryClient = useQueryClient();
  const status = useRpc(statusRpc);
  const audit = useRpc(auditRpc);
  const query = useQuery({ queryKey: STATUS_KEY, queryFn: () => status({}), refetchInterval: 15_000 });
  const log = useQuery({ queryKey: AUDIT_KEY, queryFn: () => audit({ limit: 50 }), refetchInterval: 15_000 });
  const reload = () => queryClient.invalidateQueries({ queryKey: STATUS_KEY });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Linear</Text>
      <Text style={styles.muted}>
        Agents created with PASEO_LINEAR_ISSUE=ANY-1234 are bound to that ticket. It moves to In Progress when they start, and only their linear_done call
        (with evidence) closes it. Agents never see these API keys.
      </Text>
      {query.data?.endpoint.error ? <Text style={styles.error}>{query.data.endpoint.error}</Text> : null}
      {query.error ? <Text style={styles.error}>{(query.error as Error).message}</Text> : null}

      <Text style={styles.heading}>Workspaces</Text>
      {query.data?.workspaces.length === 0 ? <Text style={styles.muted}>No API key yet. Add one per Linear workspace.</Text> : null}
      {query.data?.workspaces.map((w) => <WorkspaceCard key={w.name} name={w.name} org={w.org} styles={styles} onChanged={reload} />)}
      <AddKey styles={styles} onChanged={reload} />

      <Text style={styles.heading}>Bound agents</Text>
      {query.data?.agents.length === 0 ? <Text style={styles.muted}>No agent is bound to a ticket.</Text> : null}
      {query.data?.agents.map((a) => (
        <View key={`${a.issue}-${a.agentId ?? a.createdAt}`} style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.name}>{a.issue}</Text>
            <Text style={styles.badge}>{a.state ?? "state unknown"}</Text>
          </View>
          {a.title ? <Text style={styles.value}>{a.title}</Text> : null}
          <Text style={styles.muted}>
            {a.agentId ? `Agent ${a.agentId.slice(0, 8)}` : "Agent not started"}
            {a.archived ? ", archived" : ""}
            {a.started ? "" : ", not moved to In Progress yet"}
          </Text>
        </View>
      ))}

      <Text style={styles.heading}>Recent transitions</Text>
      {log.data?.entries.length === 0 ? <Text style={styles.muted}>Nothing yet.</Text> : null}
      {log.data?.entries.map((e, i) => (
        <Text key={i} style={styles.value}>
          {new Date(e.at).toLocaleTimeString()} {e.issue} {e.kind} {e.outcome}
          {e.from && e.to ? `: ${e.from} to ${e.to}` : ""}
          {e.outcome !== "applied" ? ` (${e.detail})` : ""}
        </Text>
      ))}
    </ScrollView>
  );
}

function WorkspaceCard({ name, org, styles, onChanged }: { name: string; org: string | null; styles: Styles; onChanged(): void }) {
  const clear = useRpc(clearKeyRpc);
  const [error, setError] = useState<string | null>(null);
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.badge}>key set</Text>
      </View>
      {org ? <Text style={styles.muted}>Linear organization: {org}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button styles={styles} label="Remove key" onPress={() => clear({ name }).then(onChanged, (e) => setError((e as Error).message))} />
    </View>
  );
}

/** Write-only: the key field is never filled from storage. */
function AddKey({ styles, onChanged }: { styles: Styles; onChanged(): void }) {
  const setKey = useRpc(setKeyRpc);
  const [name, setName] = useState("");
  const [key, setKeyValue] = useState("");
  const [nonce, setNonce] = useState(0);
  const save = useMutation({
    mutationFn: () => setKey({ name, key }),
    onSuccess: () => {
      setName("");
      setKeyValue("");
      setNonce((n) => n + 1);
      onChanged();
    },
  });
  return (
    <View key={nonce} style={styles.panel}>
      <Text style={styles.heading}>Add or replace an API key</Text>
      <SettingsInput label="Workspace name" hint="Any short name, for example anyshift. Replaces the existing key of that name." initialValue="" onChangeText={setName} />
      <SettingsInput
        label="Linear API key"
        hint="Checked against Linear when saved. Stored on the daemon in a file only its user can read, and never shown again."
        initialValue=""
        secureTextEntry
        onChangeText={setKeyValue}
        placeholder="Paste key"
      />
      {save.error ? <Text style={styles.error}>{(save.error as Error).message}</Text> : null}
      <Button styles={styles} primary label={save.isPending ? "Checking…" : "Save key"} onPress={() => name && key && save.mutate()} />
    </View>
  );
}

function Button({ styles, label, onPress, primary }: { styles: Styles; label: string; onPress(): void; primary?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.button, primary && styles.buttonPrimary]}>
      <Text style={primary ? styles.buttonPrimaryText : styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(theme: PluginScreenProps["theme"], compact: boolean) {
  const pad = compact ? 16 : 24;
  return {
    screen: { flex: 1, backgroundColor: theme.colors.surface0 },
    content: { padding: pad, gap: 12 },
    row: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, gap: 8, flexWrap: "wrap" as const },
    title: { color: theme.colors.foreground, fontSize: compact ? 20 : 24 },
    heading: { color: theme.colors.foreground, fontSize: 16, fontWeight: "600" as const },
    name: { color: theme.colors.foreground, fontSize: 15, fontWeight: "600" as const },
    muted: { color: theme.colors.foregroundMuted, fontSize: 13 },
    value: { color: theme.colors.foreground, fontSize: 14 },
    error: { color: theme.colors.foregroundMuted, fontSize: 13, fontStyle: "italic" as const },
    badge: { color: theme.colors.foregroundMuted, fontSize: 12, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
    card: { gap: 4, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 },
    panel: { gap: 10, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 },
    button: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, alignSelf: "flex-start" as const },
    buttonPrimary: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
    buttonText: { color: theme.colors.foreground, fontSize: 14 },
    buttonPrimaryText: { color: theme.colors.accentForeground, fontSize: 14 },
  };
}
