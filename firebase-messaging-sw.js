importScripts(
  "https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js"
);

importScripts(
  "https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging-compat.js"
);


// ============================================================
// FIREBASE INITIALIZATION
// ============================================================

firebase.initializeApp({
  apiKey: "AIzaSyCmAuJE-nvJunX-vXQH2l_zjjrcDt2DiA8",
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

  const data = payload.data || {};

  const title =
    data.title ||
    "FreeUpper";

  const body =
    data.body ||
    "You have a new notification.";

  // Sender's profile image
  const actorAvatar =
    data.actor_avatar_url ||
    "/freeupper.png";

  const mediaUrl =
    data.media_url ||
    data.thumbnail_url ||
    null;


  const notificationOptions = {

    body,

    // IMPORTANT:
    // Use the sender's profile image as the notification icon.
    icon: actorAvatar,

    // Keep FreeUpper branding as the notification badge.
    badge: "/freeupper.png",

    data: {

      ...data,

      destination_url:
        data.destination_url || "",

      notification_type:
        data.notification_type ||
        data.type ||
        "",

      actor_id:
        data.actor_id ||
        "",

      post_id:
        data.post_id ||
        "",

      comment_id:
        data.comment_id ||
        "",

      conversation_id:
        data.conversation_id ||
        ""
    }
  };


  // Optional media preview
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

self.addEventListener(
  "notificationclick",
  (event) => {

    event.notification.close();

    const data =
      event.notification.data || {};


    // --------------------------------------------------------
    // 1. EXPLICIT DESTINATION
    // --------------------------------------------------------

    if (data.destination_url) {

      event.waitUntil(
        openFreeUpperUrl(
          data.destination_url
        )
      );

      return;
    }


    // --------------------------------------------------------
    // 2. CHAT
    // --------------------------------------------------------

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


    // --------------------------------------------------------
    // 3. POST
    // --------------------------------------------------------

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


    // --------------------------------------------------------
    // 4. PROFILE
    // --------------------------------------------------------

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


    // --------------------------------------------------------
    // 5. FALLBACK
    // --------------------------------------------------------

    event.waitUntil(
      openFreeUpperUrl(
        "/index.html"
      )
    );

  }
);


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
  // Reuse an existing FreeUpper window
  // ----------------------------------------------------------

  for (const client of windowClients) {

    if (
      client.url.startsWith(baseUrl) &&
      "navigate" in client
    ) {

      await client.navigate(
        targetUrl
      );

      if ("focus" in client) {
        return client.focus();
      }

      return;
    }

  }


  // ----------------------------------------------------------
  // Otherwise open FreeUpper
  // ----------------------------------------------------------

  if (clients.openWindow) {

    return clients.openWindow(
      targetUrl
    );

  }

}
