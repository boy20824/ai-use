<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { useCorgiMotion } from '@/composables/usePointerMotion'
import { appName } from '@/config/app'
import { useSessionStore } from '@/stores/session'
import { safeRedirect } from '@/utils/redirect'
import { ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'

const session = useSessionStore()
const route = useRoute()
const router = useRouter()
const username = ref('')
const failed = ref(false)
const offline = ref(false)
const pending = ref(false)
const { hopping, parallaxStyle, hopOnce, onHopEnd, onParallax, resetParallax } = useCorgiMotion()

async function submit() {
  if (pending.value) return
  failed.value = false
  offline.value = false
  pending.value = true
  try {
    const result = await session.login(username.value)
    if (result === 'invalid') {
      failed.value = true
      return
    }
    if (result !== 'ok') {
      offline.value = true
      return
    }
    void router.push(safeRedirect(route.query.redirect))
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <main class="corgi-login">
    <div class="bg-mist" aria-hidden="true"></div>
    <div class="bg-grid" aria-hidden="true"></div>
    <section
      class="corgi-stage"
      aria-label="平台登入"
      @pointermove="onParallax"
      @pointerleave="resetParallax"
    >
      <div class="stage-mist" aria-hidden="true"></div>
      <div class="stage-grid" aria-hidden="true"></div>
      <div class="corgi-portrait" aria-hidden="true">
        <div class="corgi-parallax" :style="parallaxStyle">
          <div class="corgi-hop" :class="{ 'is-hop': hopping }" @animationend.self="onHopEnd">
            <div class="corgi-shadow"></div>
            <div class="corgi-actor">
              <div class="corgi-tilt">
                <img src="/images/corgi-login-hero.webp" alt="" width="1152" height="864" />
              </div>
            </div>
          </div>
        </div>
        <div class="corgi-hit" @pointerenter="hopOnce"></div>
      </div>
      <section class="corgi-card" aria-labelledby="login-title">
        <h1 id="login-title" class="corgi-brand">
          <AppIcon name="documents" hidden />{{ appName }}
        </h1>
        <form class="corgi-form" aria-label="登入" @submit.prevent="submit">
          <div class="corgi-field">
            <label for="username">帳號 <span class="ml-2 font-normal">知識互聯網</span></label>
            <input
              id="username"
              v-model="username"
              type="text"
              name="username"
              autocomplete="username"
              required
              placeholder="請輸入帳號"
              :class="{ 'corgi-field-error': failed }"
            />
          </div>
          <p v-if="failed" class="corgi-error" role="alert">帳號不正確。</p>
          <p v-if="offline" class="corgi-error" role="alert">無法連線。請確認服務已啟動。</p>
          <div class="corgi-actions">
            <button type="submit" class="corgi-submit" :disabled="pending" :aria-busy="pending">
              <span v-if="pending" class="btn-spinner" aria-hidden="true"></span>
              登入
            </button>
            <p class="corgi-register">
              <span>還沒有帳號？</span>
              <RouterLink to="/register">註冊</RouterLink>
            </p>
          </div>
        </form>
        <p class="corgi-description">輸入帳號，進入案件範本。</p>
      </section>
    </section>
  </main>
</template>

<style scoped>
.corgi-login {
  position: relative;
  overflow: hidden;
  min-height: 100dvh;
  padding: clamp(32px, 5vw, 72px);
  background: #edf0f2;
  color: #252b30;
}

.corgi-stage {
  position: relative;
  z-index: 1;
  isolation: isolate;
  display: grid;
  grid-template-rows: 1fr auto 1fr;
  min-height: max(640px, calc(100dvh - clamp(64px, 10vw, 144px)));
  padding: 28px 7.1%;
  overflow: hidden;
  border-radius: 2px;
  background: #fff;
  box-shadow:
    0 20px 70px #2336420c,
    0 2px 10px #23364205;
}

.corgi-portrait {
  position: absolute;
  z-index: 1;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  /* The animated wrappers isolate the image's blend from the stage. */
  mix-blend-mode: multiply;
}

.corgi-portrait img {
  position: absolute;
  right: -6%;
  bottom: -8%;
  display: block;
  width: auto;
  max-width: none;
  height: 110%;
  max-height: 78vw;
  mix-blend-mode: multiply;
}

.corgi-login .bg-mist,
.corgi-login .bg-grid {
  position: absolute;
  inset: -30%;
  z-index: 0;
  pointer-events: none;
}

.corgi-login .bg-mist {
  background:
    radial-gradient(ellipse 72% 52% at 16% 24%, rgba(55, 64, 74, 0.22), transparent 58%),
    radial-gradient(ellipse 58% 44% at 84% 76%, rgba(30, 36, 42, 0.16), transparent 52%),
    radial-gradient(ellipse 42% 32% at 48% 100%, rgba(80, 88, 96, 0.14), transparent 60%);
  animation: mist-drift 7s ease-in-out infinite alternate;
}

.corgi-login .bg-grid {
  background-image: radial-gradient(rgba(28, 34, 40, 0.28) 1.15px, transparent 1.3px);
  background-size: 20px 20px;
  opacity: 0.7;
  animation: grid-drift 7s linear infinite;
}

.corgi-stage .stage-mist,
.corgi-stage .stage-grid {
  position: absolute;
  inset: -18%;
  z-index: 0;
  pointer-events: none;
}

.corgi-stage .stage-mist {
  background:
    radial-gradient(ellipse 60% 48% at 82% 36%, rgba(70, 78, 86, 0.06), transparent 64%),
    radial-gradient(ellipse 46% 36% at 20% 88%, rgba(50, 58, 64, 0.04), transparent 60%);
  animation: mist-drift 7.5s ease-in-out infinite alternate-reverse;
}

.corgi-stage .stage-grid {
  background-image: radial-gradient(rgba(37, 43, 48, 0.1) 1px, transparent 1.2px);
  background-size: 24px 24px;
  opacity: 0.28;
  animation: grid-drift 8s linear infinite;
}

@keyframes mist-drift {
  from {
    transform: translate3d(-5%, -3%, 0) scale(1);
  }
  to {
    transform: translate3d(5.5%, 3.4%, 0) scale(1.1);
  }
}

@keyframes grid-drift {
  from {
    transform: translate3d(0, 0, 0);
  }
  to {
    transform: translate3d(20px, 20px, 0);
  }
}

.corgi-parallax,
.corgi-hop,
.corgi-actor,
.corgi-tilt {
  position: absolute;
  inset: 0;
}

.corgi-parallax {
  transform: rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg));
  transition: transform 0.4s ease-out;
}

.corgi-actor,
.corgi-tilt {
  transform-origin: 72% 96%;
}

.corgi-actor {
  animation: corgi-breathe 3.6s ease-in-out infinite;
}

.corgi-tilt {
  animation: corgi-tilt 10.8s ease-in-out infinite;
}

.corgi-shadow {
  position: absolute;
  z-index: 2;
  right: 10%;
  bottom: 3.5%;
  width: 38%;
  height: 7%;
  border-radius: 50%;
  pointer-events: none;
  background: radial-gradient(
    ellipse at center,
    rgba(28, 34, 40, 0.18) 0%,
    rgba(28, 34, 40, 0.07) 42%,
    transparent 72%
  );
  filter: blur(6px);
  animation: corgi-shadow 3.6s ease-in-out infinite;
}

.corgi-hit {
  position: absolute;
  inset: 0 0 0 auto;
  width: 54%;
  z-index: 3;
  pointer-events: auto;
}

@keyframes corgi-breathe {
  0%,
  100% {
    transform: translateY(0) scale(1);
  }
  50% {
    transform: translateY(-6px) scale(1.015);
  }
}

@keyframes corgi-tilt {
  0%,
  26%,
  58%,
  100% {
    transform: rotate(0deg);
  }
  34% {
    transform: rotate(-2deg);
  }
  42% {
    transform: rotate(1.8deg);
  }
  50% {
    transform: rotate(0deg);
  }
}

@keyframes corgi-shadow {
  0%,
  100% {
    transform: scale(1, 1);
    opacity: 0.9;
  }
  50% {
    transform: scale(1.14, 0.82);
    opacity: 0.5;
  }
}

@keyframes corgi-hop {
  0% {
    transform: translateY(0);
  }
  40% {
    transform: translateY(-10px);
  }
  100% {
    transform: translateY(0);
  }
}

.corgi-hop.is-hop {
  animation: corgi-hop 500ms cubic-bezier(0.22, 1.35, 0.36, 1);
}

.corgi-card {
  position: relative;
  z-index: 4;
  grid-row: 2;
  width: 340px;
  max-width: 100%;
  padding: 40px;
  border: 1px solid #f3f4f4;
  border-radius: 3px;
  background: #fff;
  box-shadow:
    0 14px 52px #1c303914,
    0 2px 10px #1c303905;
}

.corgi-brand {
  margin: 0 0 36px;
  color: #24292d;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.75;
  letter-spacing: 0.095em;
}

.corgi-form {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.corgi-field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.corgi-field label {
  color: #3d454b;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.6;
}

.corgi-field input {
  width: 100%;
  min-height: 44px;
  padding: 0;
  border: 0;
  border-bottom: 1px solid #778188;
  border-radius: 0;
  background: transparent;
  color: #252b30;
  font-size: 16px;
  line-height: 1.5;
}

.corgi-field input::placeholder {
  color: #687279;
  opacity: 1;
  font-size: 12px;
}

.corgi-field input.corgi-field-error {
  border-bottom-color: #a23f39;
}

.corgi-error {
  margin: 0;
  color: #a23f39;
  font-size: 12px;
  line-height: 1.65;
}

.corgi-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.corgi-submit {
  display: inline-flex;
  min-width: 104px;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  padding: 0 28px;
  border: 1px solid #252c31;
  border-radius: 999px;
  background: #252c31;
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.12em;
  cursor: pointer;
}

.corgi-submit:hover {
  border-color: #10171b;
  background: #10171b;
}

.corgi-register {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  margin: 0;
  color: #657079;
  font-size: 10px;
}

.corgi-register a {
  display: inline-flex;
  min-width: 52px;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  color: #3d454b;
  font-size: 12px;
  font-weight: 500;
}

.corgi-register a:hover {
  text-decoration: underline;
  text-underline-offset: 5px;
}

.corgi-field input:focus-visible,
.corgi-submit:focus-visible,
.corgi-register a:focus-visible {
  outline: 2px solid #216ac1;
  outline-offset: 4px;
}

.corgi-description {
  margin: 32px 0 0;
  color: #657079;
  font-size: 11px;
  line-height: 1.8;
}

.corgi-release {
  grid-row: 3;
  align-self: end;
  position: relative;
  width: 340px;
  max-width: 100%;
  margin-top: 32px;
  overflow-wrap: anywhere;
  color: #657079;
  font-size: 11px;
  line-height: 1.8;
}

@media (min-width: 761px) and (max-width: 1100px) {
  .corgi-stage {
    padding-inline: 5%;
  }

  .corgi-card {
    width: 320px;
    padding: 36px;
  }

  .corgi-portrait img {
    right: -18%;
    bottom: -5%;
    height: 105%;
  }
}

@media (max-width: 760px) {
  .corgi-login {
    padding: 16px;
  }

  .corgi-stage {
    display: flex;
    flex-direction: column;
    min-height: calc(100dvh - 32px);
    justify-content: flex-start;
    padding: 266px 20px 22px;
  }

  .corgi-portrait {
    inset: 0 0 auto;
    height: 268px;
    mask-image: linear-gradient(to bottom, #000 0%, #000 82%, transparent 100%);
  }

  .corgi-portrait img {
    top: 0;
    right: -24px;
    bottom: auto;
    width: 440px;
    height: 330px;
    max-height: none;
  }

  .corgi-hit {
    width: 100%;
    height: 268px;
  }

  .corgi-actor,
  .corgi-tilt {
    transform-origin: 70% 80%;
  }

  .corgi-card {
    width: 100%;
    padding: 28px;
    box-shadow:
      0 10px 36px #1c303910,
      0 1px 6px #1c303904;
  }

  .corgi-brand {
    margin-bottom: 32px;
    font-size: 13px;
    letter-spacing: 0.06em;
  }

  .corgi-form {
    gap: 20px;
  }

  .corgi-release {
    width: 100%;
    margin-top: auto;
    padding-top: 48px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .bg-mist,
  .bg-grid,
  .stage-mist,
  .stage-grid,
  .corgi-actor,
  .corgi-tilt,
  .corgi-shadow,
  .corgi-hop,
  .corgi-hop.is-hop {
    animation: none !important;
  }
  .corgi-parallax {
    transform: none !important;
    transition: none !important;
  }
  .corgi-hit {
    pointer-events: none;
  }
}

@media (hover: none), (pointer: coarse), (pointer: none) {
  .corgi-hit {
    pointer-events: none;
  }
  .corgi-parallax {
    transform: none !important;
    transition: none !important;
  }
}
</style>
