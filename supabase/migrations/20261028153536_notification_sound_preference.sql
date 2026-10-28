-- Extend the existing authenticated settings RPC, retaining its signature,
-- privileges and all existing setting behavior. No table grants or RLS changes.
CREATE OR REPLACE FUNCTION public.update_user_setting(p_key text, p_value text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_key NOT IN (
    'theme', 'language', 'autoplay', 'private_account',
    'comment_permission', 'download_quality', 'notification_settings',
    'notification_sound'
  ) THEN
    RAISE EXCEPTION 'Invalid setting key: %', p_key;
  END IF;

  CASE p_key
    WHEN 'notification_sound' THEN
      IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
      END IF;
      IF p_value IS NULL OR p_value NOT IN ('true', 'false') THEN
        RAISE EXCEPTION 'Invalid sound preference' USING ERRCODE = '22023';
      END IF;
      -- Initialize using existing defaults, safely if two devices race.
      INSERT INTO public.user_settings (user_id) VALUES (auth.uid())
      ON CONFLICT (user_id) DO NOTHING;
      -- UPDATE locks/re-evaluates the current row: concurrent JSON preferences
      -- are preserved rather than replaced by a stale browser snapshot.
      UPDATE public.user_settings
      SET notification_settings = jsonb_set(
        COALESCE(notification_settings, '{}'::jsonb),
        '{sound}', to_jsonb(p_value::boolean), true
      )
      WHERE user_id = auth.uid();
    WHEN 'autoplay' THEN
      UPDATE user_settings SET autoplay = p_value::BOOLEAN WHERE user_id = auth.uid();
    WHEN 'private_account' THEN
      UPDATE user_settings SET private_account = p_value::BOOLEAN WHERE user_id = auth.uid();
    WHEN 'notification_settings' THEN
      UPDATE user_settings SET notification_settings = p_value::JSONB WHERE user_id = auth.uid();
    ELSE
      EXECUTE format('UPDATE user_settings SET %I = $1 WHERE user_id = auth.uid()', p_key) USING p_value;
  END CASE;

  RETURN true;
END;
$function$;
