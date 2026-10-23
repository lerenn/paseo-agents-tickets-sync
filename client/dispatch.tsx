import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { dispatchRefreshRpc, dispatchSettings, dispatchStartRpc, dispatchStatusRpc, MIN_POLL_SECONDS, type DispatchSettings } from "../shared/dispatch";
import { Button, Section, type Styles } from "./ui";

const DISPATCH_KEY = ["tickets-dispatcher", "dispatch"];

function when(ms: number | null): string {
  return ms ? new Date(ms).toLocaleTimeString() : "never";
}

export function DispatchPanel({ styles }: { styles: Styles }) {
  const queryClient = useQueryClient();
  const status = useRpc(dispatchStatusRpc);
  const start = useRpc(dispatchStartRpc);
  const refresh = useRpc(dispatchRefreshRpc);
  const query = useQuery({ queryKey: DISPATCH_KEY, queryFn: () => status({}), refetchInterval: 15_000 });
  const reload = () => queryClient.invalidateQueries({ queryKey: DISPATCH_KEY });
  const startMutation = useMutation({ mutationFn: (issue: string) => start({ issue }), onSettled: reload });
  const refreshMutation = useMutation({ mutationFn: () => refresh({}), onSettled: reload });
  const [ticket, setTicket] = useState("");
  const d = query.data;

  const line = !d
    ? "Loading…"
    : `${d.auto ? "Automatic dispatch is on" : "Automatic dispatch is off"} · ${d.running} running${d.maxConcurrent ? ` of ${d.maxConcurrent}` : ""} · ${d.waiting.length} waiting`;

  return (
    <Section title="Dispatch" styles={styles} hint="Starts an agent on a ticket, in the Paseo project its team maps to, in its own worktree. The agent is bound to the ticket.">
      <Text style={styles.value}>{line}</Text>
      {d && !d.configured ? <Text style={styles.muted}>No team mapping loaded yet. Set the config source below; manual start needs it too.</Text> : null}
      {d?.configError ? <Text style={styles.error}>{d.configError}</Text> : null}
      {d?.lastPollError ? <Text style={styles.error}>Last poll: {d.lastPollError}</Text> : null}
      {query.error ? <Text style={styles.error}>{(query.error as Error).message}</Text> : null}

      <Text style={styles.label}>Start an agent on a ticket</Text>
      <View style={styles.inputs}>
        <TextInput
          style={[styles.input, styles.inputName]}
          value={ticket}
          onChangeText={setTicket}
          placeholder="Ticket, e.g. ANY-1234"
          placeholderTextColor={styles.placeholder.color}
          autoCapitalize="characters"
          autoCorrect={false}
          accessibilityLabel="Ticket"
        />
        <Button
          styles={styles}
          small
          primary
          disabled={!ticket.trim() || startMutation.isPending}
          label={startMutation.isPending ? "Starting…" : "Start Agent"}
          onPress={() => startMutation.mutate(ticket.trim(), { onSuccess: () => setTicket("") })}
        />
      </View>
      {startMutation.error ? <Text style={styles.error}>{(startMutation.error as Error).message}</Text> : null}

      {d && d.waiting.length > 0 ? <Text style={styles.label}>Waiting for a free slot</Text> : null}
      {d?.waiting.map((w) => (
        <View key={w.issue} style={styles.line}>
          <Text style={styles.value} numberOfLines={1}>{w.issue} · {w.title}</Text>
          <Button styles={styles} small label="Start Now" onPress={() => startMutation.mutate(w.issue)} />
        </View>
      ))}

      {d && d.teams.length > 0 ? <Text style={styles.label}>Teams</Text> : null}
      {d?.teams.map((t) => (
        <Text key={t.team} style={styles.value}>
          {t.team} → {t.project}
          {t.projectFound ? "" : " (project not found)"} · label {t.label} · {t.states.join(", ")}
        </Text>
      ))}

      {d && d.dispatched.length > 0 ? <Text style={styles.label}>Started by dispatch</Text> : null}
      {d?.dispatched.slice(0, 10).map((e) => (
        <View key={e.issue} style={styles.field}>
          <View style={styles.line}>
            <Text style={styles.name}>{e.issue}</Text>
            <Text style={styles.badge}>{e.status === "started" ? (e.active ? "Running" : "Started") : e.status === "failed" ? "Failed" : "Starting"}</Text>
          </View>
          <Text style={styles.muted}>{e.mode === "auto" ? "Automatic" : "Manual"} · {when(e.at)}{e.agentId ? ` · agent ${e.agentId.slice(0, 8)}` : ""}</Text>
          {e.error ? <Text style={styles.error}>{e.error}</Text> : null}
        </View>
      ))}

      <View style={styles.actions}>
        <Button styles={styles} small label={refreshMutation.isPending ? "Refreshing…" : "Refresh Now"} onPress={() => refreshMutation.mutate()} />
        {d ? <Text style={styles.muted}>Config read {when(d.configSyncedAt)} · last poll {when(d.lastPollAt)}</Text> : null}
      </View>
      {refreshMutation.error ? <Text style={styles.error}>{(refreshMutation.error as Error).message}</Text> : null}

      <DispatchSettingsForm styles={styles} onSaved={reload} />
    </Section>
  );
}

/** Non-secret settings: automatic mode, limits, and where the team mapping lives. */
function DispatchSettingsForm({ styles, onSaved }: { styles: Styles; onSaved(): void }) {
  const settings = useSettings(dispatchSettings);
  if (settings.status === "loading") return <Text style={styles.muted}>Loading settings…</Text>;
  if (settings.status === "error" || settings.status === "invalid") return <Text style={styles.error}>{settings.error}</Text>;
  return <SettingsFields key={settings.revision} values={settings.values} saving={settings.saving} saveError={settings.saveError} styles={styles} onSave={(values) => settings.save(values, settings.revision).then((ok) => ok && onSaved())} />;
}

function SettingsFields({ values, saving, saveError, styles, onSave }: { values: DispatchSettings; saving: boolean; saveError: string | null; styles: Styles; onSave(values: DispatchSettings): void }) {
  const [auto, setAuto] = useState(values.auto);
  const [max, setMax] = useState(String(values.maxConcurrent));
  const [poll, setPoll] = useState(String(values.pollSeconds));
  const [label, setLabel] = useState(values.defaultLabel);
  const [url, setUrl] = useState(values.source?.url ?? "");
  const [ref, setRef] = useState(values.source?.ref ?? "");
  const [folder, setFolder] = useState(values.source?.path ?? "");

  const number = (text: string, min: number, fallback: number) => {
    const n = Number.parseInt(text, 10);
    return Number.isFinite(n) && n >= min ? n : fallback;
  };
  const save = () =>
    onSave({
      ...values,
      auto,
      maxConcurrent: number(max, 0, values.maxConcurrent),
      pollSeconds: number(poll, MIN_POLL_SECONDS, values.pollSeconds),
      defaultLabel: label.trim() || values.defaultLabel,
      source: url.trim() ? { intervalMinutes: values.source?.intervalMinutes ?? 5, url: url.trim(), ref: ref.trim() || undefined, path: folder.trim() || undefined } : undefined,
    });

  return (
    <View style={styles.form}>
      <Text style={styles.label}>Settings</Text>
      <SettingsSwitch label="Automatic dispatch" hint="Start agents for tickets that carry the label, every poll." value={auto} onValueChange={setAuto} />
      <View style={styles.inputs}>
        <Field styles={styles} label="Default label" value={label} onChange={setLabel} placeholder="paseo" />
        <Field styles={styles} label="Max running (0 = no limit)" value={max} onChange={setMax} placeholder="3" />
        <Field styles={styles} label={`Poll seconds (min ${MIN_POLL_SECONDS})`} value={poll} onChange={setPoll} placeholder="60" />
      </View>
      <Text style={styles.label}>Config source (a git folder with dispatch.json)</Text>
      <View style={styles.inputs}>
        <Field styles={styles} label="Repository URL" value={url} onChange={setUrl} placeholder="git@github.com:owner/repo.git" grow={2} />
        <Field styles={styles} label="Ref" value={ref} onChange={setRef} placeholder="main" />
        <Field styles={styles} label="Folder" value={folder} onChange={setFolder} placeholder="path/to/folder" grow={2} />
      </View>
      {saveError ? <Text style={styles.error}>{saveError}</Text> : null}
      <View style={styles.actions}>
        <Button styles={styles} small primary disabled={saving} label={saving ? "Saving…" : "Save"} onPress={save} />
      </View>
    </View>
  );
}

function Field({ styles, label, value, onChange, placeholder, grow = 1 }: { styles: Styles; label: string; value: string; onChange(text: string): void; placeholder: string; grow?: number }) {
  return (
    <View style={{ flex: grow, gap: 2 }}>
      <Text style={styles.muted}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={styles.placeholder.color}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={label}
      />
    </View>
  );
}
