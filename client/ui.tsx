import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

/** A panel; with `collapsible` it starts closed behind a chevron header showing `summary`. */
export function Section({ title, hint, summary, collapsible, styles, children }: { title: string; hint?: string; summary?: string; collapsible?: boolean; styles: Styles; children: React.ReactNode }) {
  const [open, setOpen] = useState(!collapsible);
  return (
    <View style={styles.panel}>
      {collapsible ? (
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={title} onPress={() => setOpen((v) => !v)}>
          <Text style={styles.heading}>
            {open ? "▾" : "▸"} {title}
            {summary ? ` · ${summary}` : ""}
          </Text>
        </Pressable>
      ) : (
        <Text style={styles.heading}>{title}</Text>
      )}
      {open && hint ? <Text style={styles.muted}>{hint}</Text> : null}
      {open ? children : null}
    </View>
  );
}

export function Button({ styles, label, onPress, primary, small, disabled }: { styles: Styles; label: string; onPress(): void; primary?: boolean; small?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, small && styles.buttonSmall, primary && styles.buttonPrimary, disabled && styles.buttonDisabled]}
    >
      <Text style={[primary ? styles.buttonPrimaryText : styles.buttonText, small && styles.buttonSmallText]}>{label}</Text>
    </Pressable>
  );
}

export type Styles = ReturnType<typeof makeStyles>;

export function makeStyles(theme: PluginScreenProps["theme"], compact: boolean) {
  const pad = compact ? 16 : 24;
  return {
    screen: { flex: 1, backgroundColor: theme.colors.surface0 },
    content: { padding: pad, gap: 14 },
    title: { color: theme.colors.foreground, fontSize: compact ? 20 : 24 },
    heading: { color: theme.colors.foreground, fontSize: 16, fontWeight: "600" as const },
    name: { color: theme.colors.foreground, fontSize: 15, fontWeight: "600" as const },
    muted: { color: theme.colors.foregroundMuted, fontSize: 13 },
    value: { color: theme.colors.foreground, fontSize: 14 },
    error: { color: theme.colors.foregroundMuted, fontSize: 13, fontStyle: "italic" as const },
    badge: { color: theme.colors.foregroundMuted, fontSize: 12, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
    panel: { gap: 10, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 },
    field: { gap: 2 },
    label: { color: theme.colors.foregroundMuted, fontSize: 12, marginTop: 4 },
    line: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, gap: 12 },
    placeholder: { color: theme.colors.foregroundMuted },
    list: { gap: 10, maxWidth: 640, alignItems: "stretch" as const },
    rows: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10, backgroundColor: theme.colors.surface0 },
    row: { gap: 8, paddingVertical: 10, paddingHorizontal: 12 },
    rowDivider: { borderTopWidth: 1, borderTopColor: theme.colors.border },
    rowName: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, flexShrink: 1 },
    actions: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
    form: { gap: 8, paddingTop: 2 },
    inputs: { flexDirection: compact ? ("column" as const) : ("row" as const), gap: 8 },
    input: { minHeight: 36, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface2, color: theme.colors.foreground, fontSize: 14 },
    inputName: { flex: 1 },
    inputKey: { flex: 2 },
    button: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, alignSelf: "flex-start" as const },
    buttonSmall: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 6 },
    buttonSmallText: { fontSize: 13 },
    buttonDisabled: { opacity: 0.5 },
    buttonPrimary: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
    buttonText: { color: theme.colors.foreground, fontSize: 14 },
    buttonPrimaryText: { color: theme.colors.accentForeground, fontSize: 14 },
  };
}
