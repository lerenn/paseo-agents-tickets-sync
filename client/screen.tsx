import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import type { BackendId, BackendInfo } from "../shared/backends";
import { auditRpc, clearKeyRpc, setKeyRpc, statusRpc } from "../shared/rpc";
import { DispatchPanel } from "./dispatch";
import { Button, makeStyles, Section, type Styles } from "./ui";

const STATUS_KEY = ["tickets-dispatcher", "status"];
const AUDIT_KEY = ["tickets-dispatcher", "audit"];


type Workspace = { name: string; backend: BackendId; scope: string | null };

export function TicketsScreen({ theme, layout }: PluginScreenProps) {
  const styles = useMemo(() => makeStyles(theme, layout.compact), [theme, layout.compact]);
  const queryClient = useQueryClient();
  const status = useRpc(statusRpc);
  const audit = useRpc(auditRpc);
  const query = useQuery({ queryKey: STATUS_KEY, queryFn: () => status({}), refetchInterval: 15_000 });
  const log = useQuery({ queryKey: AUDIT_KEY, queryFn: () => audit({ limit: 20 }), refetchInterval: 15_000 });
  const reload = () => queryClient.invalidateQueries({ queryKey: STATUS_KEY });
  const backends = query.data?.backends ?? [];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Tickets Dispatcher</Text>
      <Text style={styles.muted}>
        An agent created with PASEO_AGENT_TICKET=ANY-1234 is bound to that ticket, and its status follows the agent's work.
      </Text>
      {query.data?.endpoint.error ? <Text style={styles.error}>{query.data.endpoint.error}</Text> : null}
      {query.error ? <Text style={styles.error}>{(query.error as Error).message}</Text> : null}

      <Connections workspaces={query.data?.workspaces ?? []} backends={backends} styles={styles} onChanged={reload} />

      <DispatchPanel styles={styles} />

      <Section title="Bound agents" styles={styles}>
        {query.data?.agents.length === 0 ? <Text style={styles.muted}>No agent is bound to a ticket.</Text> : null}
        {query.data?.agents.map((a) => (
          <View key={`${a.issue}-${a.agentId ?? a.createdAt}`} style={styles.field}>
            <View style={styles.line}>
              <Text style={styles.name}>{a.issue}</Text>
              <Text style={styles.badge}>{a.state ?? "State unknown"}</Text>
            </View>
            {a.title ? <Text style={styles.value}>{a.title}</Text> : null}
            <Text style={styles.muted}>
              {a.agentId ? `Agent ${a.agentId.slice(0, 8)}` : "Agent not started"}
              {a.archived ? " · archived" : ""}
              {a.started ? "" : " · not moved to In Progress yet"}
            </Text>
          </View>
        ))}
      </Section>

      <Section title="Recent transitions" styles={styles}>
        {log.data?.entries.length === 0 ? <Text style={styles.muted}>Nothing yet.</Text> : null}
        {log.data?.entries.map((e, i) => (
          <Text key={`${e.at}-${i}`} style={styles.value}>
            {new Date(e.at).toLocaleTimeString()} · {e.issue} · {e.kind} · {e.outcome}
            {e.from && e.to ? ` · ${e.from} to ${e.to}` : ""}
            {e.outcome !== "applied" ? ` (${e.detail})` : ""}
          </Text>
        ))}
      </Section>
    </ScrollView>
  );
}

function Connections({ workspaces, backends, styles, onChanged }: { workspaces: Workspace[]; backends: BackendInfo[]; styles: Styles; onChanged(): void }) {
  const [adding, setAdding] = useState(false);
  return (
    <Section
      title="Connections"
      styles={styles}
      hint="A connection lets the daemon read and update tickets for your agents, so the agents never hold the key. Saved on this machine and never shown again."
    >
      <View style={styles.list}>
        {workspaces.length === 0 ? <Text style={styles.muted}>No connections yet.</Text> : null}
        {workspaces.length > 0 ? (
          <View style={styles.rows}>
            {workspaces.map((w, i) => (
              <ConnectionRow key={w.name} workspace={w} backend={backends.find((b) => b.id === w.backend)} first={i === 0} styles={styles} onChanged={onChanged} />
            ))}
          </View>
        ) : null}
        {adding ? (
          <ConnectionForm backends={backends} styles={styles} onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); onChanged(); }} />
        ) : (
          <Button styles={styles} label="Add Connection" onPress={() => setAdding(true)} />
        )}
      </View>
    </Section>
  );
}

function ConnectionRow({ workspace, backend, first, styles, onChanged }: { workspace: Workspace; backend?: BackendInfo; first: boolean; styles: Styles; onChanged(): void }) {
  const clear = useRpc(clearKeyRpc);
  const [replacing, setReplacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <View style={[styles.row, !first && styles.rowDivider]}>
      <View style={styles.line}>
        <View style={styles.rowName}>
          <Icon name={backend?.icon ?? "Plug"} size={16} color={styles.value.color} />
          <Text style={styles.value} numberOfLines={1}>{backend?.label ?? workspace.backend}</Text>
          <Text style={styles.name} numberOfLines={1}>{workspace.name}</Text>
          <Text style={styles.badge}>Set</Text>
        </View>
        <View style={styles.actions}>
          <Button styles={styles} small label={replacing ? "Cancel" : "Replace"} onPress={() => setReplacing((v) => !v)} />
          <Button styles={styles} small label="Remove" onPress={() => clear({ name: workspace.name }).then(onChanged, (e) => setError((e as Error).message))} />
        </View>
      </View>
      {workspace.scope ? <Text style={styles.muted}>{workspace.scope}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {replacing ? (
        <ConnectionForm
          backends={backend ? [backend] : []}
          fixed={workspace}
          styles={styles}
          onCancel={() => setReplacing(false)}
          onSaved={() => { setReplacing(false); onChanged(); }}
        />
      ) : null}
    </View>
  );
}

/**
 * Compact inline form. Write-only: the key field starts empty, is masked, and is cleared after
 * saving. Without `fixed` it also asks which backend and what to call the connection.
 */
function ConnectionForm({ backends, fixed, styles, onCancel, onSaved }: { backends: BackendInfo[]; fixed?: Workspace; styles: Styles; onCancel(): void; onSaved(): void }) {
  const setKey = useRpc(setKeyRpc);
  const [backend, setBackend] = useState<BackendId | undefined>(fixed?.backend ?? backends[0]?.id);
  const [name, setName] = useState("");
  const [key, setKeyValue] = useState("");
  const who = (fixed?.name ?? name).trim();
  const ready = Boolean(backend) && who.length > 0 && key.trim().length > 0;
  const save = useMutation({
    mutationFn: () => setKey({ backend: backend as BackendId, name: who, key }),
    onSuccess: () => {
      setKeyValue("");
      onSaved();
    },
  });
  return (
    <View style={styles.form}>
      {fixed || backends.length === 0 ? null : (
        <SettingsSelect<BackendId>
          label="Backend"
          value={backend ?? backends[0].id}
          options={backends.map((b) => ({ label: b.label, value: b.id }))}
          onValueChange={setBackend}
        />
      )}
      <View style={styles.inputs}>
        {fixed ? null : (
          <TextInput
            style={[styles.input, styles.inputName]}
            value={name}
            onChangeText={setName}
            placeholder="Workspace name, e.g. anyshift"
            placeholderTextColor={styles.placeholder.color}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Workspace name"
          />
        )}
        <TextInput
          style={[styles.input, styles.inputKey]}
          value={key}
          onChangeText={setKeyValue}
          placeholder={fixed ? `New API key for ${fixed.name}` : "Paste API key"}
          placeholderTextColor={styles.placeholder.color}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="API key"
        />
      </View>
      {save.error ? <Text style={styles.error}>{(save.error as Error).message}</Text> : null}
      <View style={styles.actions}>
        <Button styles={styles} small primary disabled={!ready || save.isPending} label={save.isPending ? "Checking…" : "Save"} onPress={() => ready && save.mutate()} />
        <Button styles={styles} small label="Cancel" onPress={onCancel} />
      </View>
    </View>
  );
}
