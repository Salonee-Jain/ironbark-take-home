<script setup lang="ts">
import { ref } from 'vue';

const emit = defineEmits<{
  submit: [email: string, password: string];
}>();

defineProps<{
  busy?: boolean;
  error?: string | null;
}>();

const email = ref('demo@ironbarkridge.com.au');
const password = ref('demo1234');

function submit(): void {
  emit('submit', email.value, password.value);
}
</script>

<template>
  <section class="login card" aria-labelledby="sign-in-title">
    <div class="copy">
      <p class="eyebrow">Secure workspace</p>
      <h2 id="sign-in-title">Sign in to the dashboard</h2>
      <p>
        Use the demo account to explore the Ironbark Ridge dataset, or sign in
        with an account you have already created.
      </p>
    </div>

    <form @submit.prevent="submit">
      <label>
        Email address
        <input v-model="email" type="email" autocomplete="email" required />
      </label>
      <label>
        Password
        <input
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
        />
      </label>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <button type="submit" :disabled="busy">
        {{ busy ? 'Signing in…' : 'Sign in' }}
      </button>
    </form>

    <p class="note">Demo access: demo@ironbarkridge.com.au · demo1234</p>
  </section>
</template>

<style scoped>
.login {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(280px, 0.9fr);
  gap: 34px;
  padding: 28px;
  max-width: 780px;
}

.eyebrow {
  color: var(--scope2);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

h2 {
  font-size: 22px;
  letter-spacing: -0.025em;
  margin-top: 5px;
}

.copy > p:not(.eyebrow) {
  color: var(--text-secondary);
  margin-top: 9px;
  max-width: 40ch;
}

form {
  display: grid;
  gap: 13px;
}

label {
  display: grid;
  gap: 5px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

input {
  width: 100%;
  padding: 9px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-page);
  color: var(--text-primary);
  font: inherit;
  font-weight: 400;
}

button {
  justify-self: start;
  padding: 9px 14px;
  border: 1px solid var(--scope2);
  border-radius: 6px;
  background: var(--scope2);
  color: white;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

button:disabled { cursor: wait; opacity: 0.7; }

.form-error { color: var(--status-critical); font-size: 12px; }
.note { grid-column: 1 / -1; color: var(--text-muted); font-size: 11.5px; }

@media (max-width: 620px) {
  .login { grid-template-columns: 1fr; gap: 20px; padding: 20px; }
}
</style>
