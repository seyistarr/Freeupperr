importScripts(
  "https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js"
);

importScripts(
  "https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging-compat.js"
);


// ============================================================
// FIREBASE INITIALIZATION
// ============================================================
// NOTE: projectId must match FIREBASE_PROJECT_ID in the
// Supabase Edge Function ("freeupper-notifications").

firebase.initializeApp({
  apiKey: "AIzaSyCmAu-nvJunX-vXQH2l_zjjrcDt2DiA8",
  authDomain: "freeupper-notifications.firebaseapp.com",
  projectId: "freeupper-notifications",
  storageBucket: "freeupper-notifications.firebasestorage.app",
  messagingSenderId: "37328138260",
  appId: "1:37328138260:web:f362538c37f279fccf7701"
});


const messaging = firebase.messaging();


// ============================================================
// BACKGROUND NOTIFICATIONS
// ============================================================

messaging.onBackgroundMessage((payload) => {

  console.log(
    "[FreeUpper FCM] Background message:",
    payload
  );

  const notification = payload.notification || {};
  const data = payload.data || {};

  const title =
    notification.title ||
    data.title ||
    "FreeUpper";

  const body =
    notification.body ||
    data.body ||
    "You have a new notification.";

  const actorAvatar =
    data.actor_avatar_url ||
    data.avatar_url ||
    "/freeupper.png";

  const mediaUrl =
    data.media_url ||
    data.thumbnail_url ||
    null;


  const notificationOptions = {

    body,

    icon: actorAvatar,

    badge: "/freeupper.png",

    data: {
      ...data,

      // Preserve these values explicitly.
      destination_url:
        data.destination_url || "",

      notification_type:
        data.notification_type || data.type || "",

      actor_id:
        data.actor_id || "",

      post_id:
        data.post_id || "",

      comment_id:
        data.comment_id || "",

      conversation_id:
        data.conversation_id || ""
    }
  };


  // Add media preview only when we actually have media.
  if (mediaUrl) {
    notificationOptions.image = mediaUrl;
  }


  return self.registration.showNotification(
    title,
    notificationOptions
  );
});


// ============================================================
// NOTIFICATION CLICK
// ============================================================

self.addEventListener("notificationclick", (event) => {

  console.log(
    "[FreeUpper FCM] Notification clicked:",
    event.notification
  );

  event.notification.close();

  const data =
    event.notification.data || {};


  // ----------------------------------------------------------
  // 1. EXPLICIT DESTINATION
  // ----------------------------------------------------------

  if (data.destination_url) {
    event.waitUntil(
      openFreeUpperUrl(data.destination_url)
    );

    return;
  }


  // ----------------------------------------------------------
  // 2. CHAT
  // ----------------------------------------------------------

  if (data.conversation_id) {

    const url =
      `/chat.html?conversation=${encodeURIComponent(
        data.conversation_id
      )}`;

    event.waitUntil(
      openFreeUpperUrl(url)
    );

    return;
  }


  // ----------------------------------------------------------
  // 3. POST-RELATED NOTIFICATION
  // ----------------------------------------------------------

  if (data.post_id) {

    const url =
      `/index.html?post=${encodeURIComponent(
        data.post_id
      )}`;

    event.waitUntil(
      openFreeUpperUrl(url)
    );

    return;
  }


  // ----------------------------------------------------------
  // 4. PROFILE / FOLLOW NOTIFICATION
  // ----------------------------------------------------------

  if (data.actor_id) {

    const url =
      `/profile.html?uid=${encodeURIComponent(
        data.actor_id
      )}`;

    event.waitUntil(
      openFreeUpperUrl(url)
    );

    return;
  }


  // ----------------------------------------------------------
  // 5. FALLBACK
  // ----------------------------------------------------------

  event.waitUntil(
    openFreeUpperUrl("/index.html")
  );

});


// ============================================================
// OPEN / FOCUS FREEUPPER
// ============================================================

async function openFreeUpperUrl(path) {

  const baseUrl =
    self.location.origin;

  const targetUrl =
    new URL(
      path,
      baseUrl
    ).href;


  const windowClients =
    await clients.matchAll({
      type: "window",
      includeUncontrolled: true
    });


  // ----------------------------------------------------------
  // If FreeUpper is already open, reuse it.
  // ----------------------------------------------------------

  for (const client of windowClients) {

    if (
      client.url.startsWith(baseUrl) &&
      "navigate" in client
    ) {

      await client.navigate(targetUrl);

      if ("focus" in client) {
        return client.focus();
      }

      return;
    }
  }


  // ----------------------------------------------------------
  // Otherwise open a new FreeUpper tab.
  // ----------------------------------------------------------

  if (clients.openWindow) {
    return clients.openWindow(targetUrl);
  }

}
