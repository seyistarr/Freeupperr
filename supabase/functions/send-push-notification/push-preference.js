// Missing settings/key preserves existing users' push delivery. Lookup failures stop the send.
export async function getPushEnabledRecipients(supabase, recipientIds) {
    const ids = [...new Set(recipientIds)].filter(Boolean);
    if (!ids.length) return [];
    const { data, error } = await supabase.from('user_settings')
        .select('user_id, notification_settings').in('user_id', ids);
    if (error) throw new Error('Could not check global push preferences.');
    const disabled = new Set((data || [])
        .filter(row => row.notification_settings?.push_enabled === false)
        .map(row => row.user_id));
    return ids.filter(id => !disabled.has(id));
}
