import { Buffer } from "buffer";
window.global ||= window;
window.Buffer = Buffer;

import { createApp } from "vue";

import { createRouter, createWebHistory } from "vue-router";
import HomeView from "./views/HomeView.vue";

import App from "./App.vue";

const app = createApp(App);

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/",
      name: "home",
      component: HomeView,
    },
  ],
});
app.use(router);

app.mount("#app");
