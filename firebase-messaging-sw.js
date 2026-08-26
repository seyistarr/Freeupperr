importScripts("https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyCmAuJE-nvJunX-vXQH2l_zjjrcDt2DiA8",
  authDomain: "freeupper-notifications.firebaseapp.com",
  projectId: "freeupper-notifications",
  storageBucket: "freeupper-notifications.firebasestorage.app",
  messagingSenderId: "37328138260",
  appId: "1:37328138260:web:f362538c37f279fccf7701"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {};
  self.registration.showNotification(n.title || "FreeUpper", {
    body: n.body || "You have a new message.",
    icon: "/freeupper.png",
    data: payload.data || {}
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const conversationId = (event.notification.data || {}).conversation_id;
  const url = conversationId ? `/chat.html?conversation=${encodeURIComponent(conversationId)}` : "/chat.html";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) { client.navigate(url); return client.focus(); }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
