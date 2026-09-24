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
// PLATFORM DETECTION
// ============================================================

function isIOSWebApp() {
  const ua = self.navigator?.userAgent || "";

  return (
    /iPhone|iPad|iPod/i.test(ua) ||
    (
      /Macintosh/i.test(ua) &&
      Number(self.navigator?.maxTouchPoints || 0) > 1
    )
  );
}


// ============================================================
// APP BADGE
// ============================================================

async function updateFreeUpperBadge(unreadCount) {
  try {
    if (
      !self.navigator ||
      typeof self.navigator.setAppBadge !== "function"
    ) {
      return;
    }

    const count = Number(unreadCount);

    if (!Number.isFinite(count) || count <= 0) {
      if (
        typeof self.navigator.clearAppBadge === "function"
      ) {
        await self.navigator.clearAppBadge();
      }

      return;
    }

    await self.navigator.setAppBadge(
      Math.floor(count)
    );

  } catch (error) {
    console.warn(
      "FreeUpper badge update failed:",
      error
    );
  }
}


async function clearFreeUpperBadge() {
  try {
    if (
      self.navigator &&
      typeof self.navigator.clearAppBadge === "function"
    ) {
      await self.navigator.clearAppBadge();
    }

  } catch (error) {
    console.warn(
      "FreeUpper badge clear failed:",
      error
    );
  }
}


// ============================================================
// BACKGROUND NOTIFICATIONS
// ============================================================

messaging.onBackgroundMessage(async (payload) => {

  const data =
    payload.data || {};

  const senderName =
    data.sender_name ||
    data.title ||
    "FreeUpper";

  const title =
    data.title ||
    senderName;

  const body =
    data.body ||
    "You have a new notification.";

  const actorAvatar =
    data.actor_avatar_url ||
    "/freeupper.png";

  const mediaUrl =
    data.media_url ||
    data.thumbnail_url ||
    null;

  const iosWebApp =
    isIOSWebApp();


  // ----------------------------------------------------------
  // REAL UNREAD COUNT
  // ----------------------------------------------------------

  /*
   * The Edge Function must send:
   *
   * unread_count: "5"
   *
   * in the FCM data payload.
   *
   * We intentionally DO NOT use 1 as a fake fallback.
   */

  if (
    Object.prototype.hasOwnProperty.call(
      data,
      "unread_count"
    )
  ) {
    await updateFreeUpperBadge(
      data.unread_count
    );
  }


  // ----------------------------------------------------------
  // NOTIFICATION OPTIONS
  // ----------------------------------------------------------

  const notificationOptions = {

    body,

    /*
     * Android + desktop:
     * sender profile image.
     *
     * iPhone/iPad:
     * FreeUpper app icon because iOS/WebKit
     * controls the notification identity icon.
     */

    icon: iosWebApp
      ? "/freeupper.png"
      : actorAvatar,

    badge:
      "/freeupper.png",

    dir:
      "auto",

    lang:
      "en-US",

    data: {

      ...data,

      sender_name:
        senderName,

      sender_avatar_url:
        actorAvatar,

      destination_url:
        data.destination_url ||
        "",

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


  // ----------------------------------------------------------
  // MEDIA PREVIEW
  // ----------------------------------------------------------

  /*
   * Keep existing media previews on Android/desktop.
   *
   * iOS gets the clean FreeUpper-branded notification
   * presentation.
   */

  if (
    mediaUrl &&
    !iosWebApp
  ) {
    notificationOptions.image =
      mediaUrl;
  }


  // ----------------------------------------------------------
  // SHOW NOTIFICATION
  // ----------------------------------------------------------

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

    if (
      data.destination_url
    ) {

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

    if (
      data.conversation_id
    ) {

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

    if (
      data.post_id
    ) {

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

    if (
      data.actor_id
    ) {

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
  // REUSE EXISTING FREEUPPER WINDOW
  // ----------------------------------------------------------

  for (
    const client of windowClients
  ) {

    if (
      client.url.startsWith(baseUrl) &&
      "navigate" in client
    ) {

      await client.navigate(
        targetUrl
      );

      if (
        "focus" in client
      ) {
        return client.focus();
      }

      return;
    }

  }


  // ----------------------------------------------------------
  // OTHERWISE OPEN FREEUPPER
  // ----------------------------------------------------------

  if (
    clients.openWindow
  ) {

    return clients.openWindow(
      targetUrl
    );

  }

}
