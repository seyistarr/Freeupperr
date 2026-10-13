import { getPushEnabledRecipients } from './push-preference.js';
import { createClient } from "npm:@supabase/supabase-js@2";
import { GoogleAuth } from "npm:google-auth-library@9";

const FIREBASE_PROJECT_ID = "freeupper-notifications";

const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL")!;

const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const FIREBASE_SERVICE_ACCOUNT =
  JSON.parse(
    Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON")!
  );

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);


// ============================================================
// FIREBASE ACCESS TOKEN
// ============================================================

async function getAccessToken() {
  const auth = new GoogleAuth({
    credentials: FIREBASE_SERVICE_ACCOUNT,
    scopes: [
      "https://www.googleapis.com/auth/firebase.messaging"
    ],
  });

  const client =
    await auth.getClient();

  const { token } =
    await client.getAccessToken();

  return token;
}


// ============================================================
// UNREAD MESSAGE COUNT
// ============================================================

async function getUnreadMessageCount(
  userId: string
) {
  const {
    data,
    error
  } = await supabase.rpc(
    "get_unread_message_count",
    {
      p_user_id: userId
    }
  );

  if (error) {
    console.error(
      "unread message count error:",
      JSON.stringify(error)
    );

    return null;
  }

  const count =
    Number(data);

  if (
    !Number.isFinite(count) ||
    count < 0
  ) {
    return 0;
  }

  return Math.floor(count);
}


// ============================================================
// UNREAD SOCIAL NOTIFICATION COUNT
// ============================================================

async function getUnreadNotificationCount(
  userId: string
) {
  const {
    count,
    error
  } = await supabase
    .from("notifications")
    .select(
      "id",
      {
        count: "exact",
        head: true
      }
    )
    .eq(
      "receiver_id",
      userId
    )
    .eq(
      "read",
      false
    );

  if (error) {
    console.error(
      "unread notification count error:",
      JSON.stringify(error)
    );

    return null;
  }

  return Math.max(
    0,
    Number(count || 0)
  );
}


// ============================================================
// COMBINED FREEUPPER BADGE COUNT
// ============================================================

async function getCombinedUnreadCount(
  userId: string
) {
  const [
    messages,
    notifications
  ] = await Promise.all([
    getUnreadMessageCount(userId),
    getUnreadNotificationCount(userId)
  ]);

  if (
    messages === null &&
    notifications === null
  ) {
    return null;
  }

  return (
    (messages ?? 0) +
    (notifications ?? 0)
  );
}


// ============================================================
// SEND FCM TO RECIPIENT TOKENS
// ============================================================

async function sendToTokens(
  recipientIds: string[],
  dataPayload: Record<string, string>
) {

  recipientIds = await getPushEnabledRecipients(supabase, recipientIds);
  if (!recipientIds.length) return;

  const {
    data: tokens,
    error: tokenError
  } = await supabase
    .from("push_tokens")
    .select(
      "token, user_id, platform"
    )
    .in(
      "user_id",
      recipientIds
    );

  if (tokenError) {

    console.error(
      "push_tokens lookup error:",
      tokenError
    );

    return;
  }

  if (
    !tokens ||
    !tokens.length
  ) {
    return;
  }

  const accessToken =
    await getAccessToken();


  // ----------------------------------------------------------
  // Calculate badge count once per user
  // ----------------------------------------------------------

  const unreadCounts =
    new Map<
      string,
      number | null
    >();

  await Promise.all(
    recipientIds.map(
      async (userId) => {

        unreadCounts.set(
          userId,
          await getCombinedUnreadCount(
            userId
          )
        );

      }
    )
  );


  // ----------------------------------------------------------
  // Send to every registered device
  // ----------------------------------------------------------

  // Recheck after badge/token work so a recent opt-out also suppresses queued work.
  const enabledRecipients = new Set(await getPushEnabledRecipients(supabase, recipientIds));

  await Promise.all(

    tokens.filter(({ user_id }) => enabledRecipients.has(user_id)).map(
      async ({
        token,
        user_id,
        platform
      }) => {

        const unreadCount =
          unreadCounts.get(
            user_id
          ) ?? null;

        const payload = {
          ...dataPayload
        };


        // ----------------------------------------------------
        // Real FreeUpper unread badge count
        // ----------------------------------------------------

        if (
          unreadCount !== null
        ) {

          payload.unread_count =
            String(
              unreadCount
            );

        }


        // ----------------------------------------------------
        // FCM request
        // ----------------------------------------------------

        const res =
          await fetch(
            `https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`,
            {
              method: "POST",

              headers: {
                Authorization:
                  `Bearer ${accessToken}`,

                "Content-Type":
                  "application/json"
              },

              body:
                JSON.stringify({
                  message: {

                    token,

                    data:
                      payload,

                    webpush: {

                      fcm_options: {

                        link:
                          payload.destination_url ||
                          "https://freeupper.vercel.app/index.html"

                      }

                    }

                  }
                })
            }
          );


        const responseText =
          await res.text();


        console.log(
          "FCM RESPONSE:",
          JSON.stringify({
            user_id,
            platform,
            status:
              res.status,
            ok:
              res.ok,
            unread_count:
              unreadCount,
            type:
              payload.notification_type ||
              "",
            body:
              responseText
          })
        );


        // ----------------------------------------------------
        // Remove invalid tokens
        // ----------------------------------------------------

        if (
          !res.ok &&
          (
            res.status === 404 ||
            res.status === 400
          )
        ) {

          await supabase
            .from("push_tokens")
            .delete()
            .eq(
              "token",
              token
            );

        }

      }
    )

  );
}


// ============================================================
// CHAT MESSAGE NOTIFICATION
// ============================================================

async function handleMessageNotification(
  message: any
) {

  if (
    !message ||
    message.is_system
  ) {

    return "skip: no message or is_system";

  }


  const {
    data: conv,
    error: convError
  } = await supabase
    .from("conversations")
    .select(
      `
      id,
      is_group,
      is_note,
      user1_id,
      user2_id,
      group_name,
      muted_by
      `
    )
    .eq(
      "id",
      message.conversation_id
    )
    .single();


  if (convError) {

    console.error(
      "conversation lookup error:",
      convError
    );

    return "skip: conversation lookup failed";

  }


  if (
    !conv ||
    conv.is_note
  ) {

    return "skip: no conv or is_note";

  }


  let recipientIds:
    string[] = [];


  // ----------------------------------------------------------
  // GROUP CHAT
  // ----------------------------------------------------------

  if (
    conv.is_group
  ) {

    const {
      data: members,
      error: membersError
    } = await supabase
      .from(
        "conversation_members"
      )
      .select(
        "user_id"
      )
      .eq(
        "conversation_id",
        conv.id
      );


    if (membersError) {

      console.error(
        "conversation members lookup error:",
        membersError
      );

    }


    recipientIds =
      (members || [])
        .map(
          member =>
            member.user_id
        )
        .filter(
          (
            id
          ): id is string =>
            Boolean(id) &&
            id !==
              message.sender_id
        );

  }


  // ----------------------------------------------------------
  // ONE-TO-ONE CHAT
  // ----------------------------------------------------------

  else {

    recipientIds = [
      conv.user1_id,
      conv.user2_id
    ]
      .filter(
        (
          id
        ): id is string =>
          Boolean(id) &&
          id !==
            message.sender_id
      );

  }


  // ----------------------------------------------------------
  // Remove duplicates
  // ----------------------------------------------------------

  recipientIds = [
    ...new Set(
      recipientIds
    )
  ];


  // ----------------------------------------------------------
  // Respect muted conversations
  // ----------------------------------------------------------

  recipientIds =
    recipientIds.filter(
      id =>
        !(
          conv.muted_by ||
          []
        ).includes(id)
    );


  if (
    !recipientIds.length
  ) {

    return "no recipients";

  }


  // ----------------------------------------------------------
  // Sender profile
  // ----------------------------------------------------------

  const {
    data: sender
  } = await supabase
    .from("profiles")
    .select(
      `
      display_name,
      username,
      avatar_url
      `
    )
    .eq(
      "id",
      message.sender_id
    )
    .single();


  const senderName =
    sender?.display_name ||
    sender?.username ||
    "Someone";


  const senderAvatar =
    sender?.avatar_url ||
    "https://freeupper.vercel.app/freeupper.png";


  // ----------------------------------------------------------
  // Notification title
  // ----------------------------------------------------------

  const title =
    conv.is_group
      ? `${senderName} in ${
          conv.group_name ||
          "a group"
        }`
      : senderName;


  // ----------------------------------------------------------
  // Notification body
  // ----------------------------------------------------------

  const body =
    message.text
      ? (
          message.text.length > 60
            ? message.text.slice(
                0,
                60
              ) + "…"
            : message.text
        )

      : message.message_type === "image"
        ? "📷 Photo"

        : message.message_type === "video"
          ? "🎬 Video"

          : message.message_type === "voice"
            ? "🎤 Voice note"

            : message.message_type === "poll"
              ? "📊 Poll"

              : "Sent an attachment";


  // ----------------------------------------------------------
  // Send
  // ----------------------------------------------------------

  await sendToTokens(
    recipientIds,
    {

      title,

      body,

      conversation_id:
        String(
          message.conversation_id
        ),

      actor_id:
        String(
          message.sender_id
        ),

      actor_avatar_url:
        senderAvatar,

      notification_type:
        "message",

      destination_url:
        `https://freeupper.vercel.app/chat.html?conversation=${encodeURIComponent(
          message.conversation_id
        )}`

    }
  );


  return "ok";
}


// ============================================================
// SOCIAL NOTIFICATION
// ============================================================

async function handleSocialNotification(
  notification: any
) {

  if (!notification) {

    return "skip: no notification";

  }


  const allowedTypes =
    new Set([
      "like",
      "comment",
      "reply",
      "follow",
      "mention",
      "repost"
    ]);


  if (
    !allowedTypes.has(
      notification.type
    )
  ) {

    return `skip: unsupported notification type ${
      notification.type || ""
    }`;

  }


  const receiverId =
    notification.receiver_id;


  const actorId =
    notification.actor_id;


  // ----------------------------------------------------------
  // Never notify yourself
  // ----------------------------------------------------------

  if (
    !receiverId ||
    !actorId ||
    receiverId === actorId
  ) {

    return "skip: invalid/self notification";

  }


  // ----------------------------------------------------------
  // Actor profile
  // ----------------------------------------------------------

  const {
    data: actor
  } = await supabase
    .from("profiles")
    .select(
      `
      display_name,
      username,
      avatar_url
      `
    )
    .eq(
      "id",
      actorId
    )
    .single();


  const actorName =
    actor?.display_name ||
    actor?.username ||
    "Someone";


  const actorAvatar =
    actor?.avatar_url ||
    "https://freeupper.vercel.app/freeupper.png";


  // ----------------------------------------------------------
  // Notification title/body
  // ----------------------------------------------------------

  let title =
    "FreeUpper";

  let body =
    "You have a new notification";


  switch (
    notification.type
  ) {

    case "like":

      title =
        actorName;

      body =
        notification.comment_id
          ? "Liked your comment"
          : "Liked your post";

      break;


    case "comment":

      title =
        actorName;

      body =
        "Commented on your post";

      break;


    case "reply":

      title =
        actorName;

      body =
        "Replied to your comment";

      break;


    case "follow":

      title =
        actorName;

      body =
        "Started following you";

      break;


    case "mention":

      title =
        actorName;

      body =
        notification.comment_id
          ? "Mentioned you in a comment"
          : "Mentioned you in a post";

      break;


    case "repost":

      title =
        actorName;

      body =
        "Reposted your post";

      break;

  }


  // ----------------------------------------------------------
  // Exact destination
  // ----------------------------------------------------------

  let destinationUrl =
    "https://freeupper.vercel.app/index.html";


  if (
    notification.type ===
    "follow"
  ) {

    destinationUrl =
      `https://freeupper.vercel.app/profile.html?uid=${encodeURIComponent(
        actorId
      )}`;

  }

  else if (
    notification.post_id
  ) {

    destinationUrl =
      `https://freeupper.vercel.app/index.html?post=${encodeURIComponent(
        notification.post_id
      )}`;

  }

  else {

    destinationUrl =
      `https://freeupper.vercel.app/profile.html?uid=${encodeURIComponent(
        actorId
      )}`;

  }


  // ----------------------------------------------------------
  // Send social notification
  // ----------------------------------------------------------

  await sendToTokens(
    [receiverId],
    {

      title,

      body,

      notification_type:
        String(
          notification.type
        ),

      actor_id:
        String(
          actorId
        ),

      actor_avatar_url:
        actorAvatar,

      post_id:
        notification.post_id
          ? String(
              notification.post_id
            )
          : "",

      comment_id:
        notification.comment_id
          ? String(
              notification.comment_id
            )
          : "",

      notification_id:
        String(
          notification.id
        ),

      destination_url:
        destinationUrl

    }
  );


  return "ok";
}


// ============================================================
// MAIN EDGE FUNCTION
// ============================================================

Deno.serve(
  async (req) => {

    try {

      const payload =
        await req.json();


      // ------------------------------------------------------
      // SOCIAL NOTIFICATION
      // ------------------------------------------------------

      if (
        payload.table ===
        "notifications"
      ) {

        const result =
          await handleSocialNotification(
            payload.record
          );

        return new Response(
          result,
          {
            status: 200
          }
        );

      }


      // ------------------------------------------------------
      // CHAT MESSAGE
      // ------------------------------------------------------

      if (
        payload.table ===
        "messages"
      ) {

        const result =
          await handleMessageNotification(
            payload.record
          );

        return new Response(
          result,
          {
            status: 200
          }
        );

      }


      // ------------------------------------------------------
      // Unsupported event
      // ------------------------------------------------------

      return new Response(
        "skip: unsupported table",
        {
          status: 200
        }
      );

    }

    catch (err) {

      console.error(
        "send-push-notification error:",
        err
      );

      return new Response(
        String(err),
        {
          status: 500
        }
      );

    }

  }
);