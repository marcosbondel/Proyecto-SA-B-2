<script setup lang="ts">
import { ACCOUNT_TYPE_PRESENTATION } from '../../lib/account';
import type { AccountType } from '../../lib/account';

/**
 * The two account types, as two cards rather than a dropdown.
 *
 * Straight from `show.createAccount` in the prototype, and the shape is the
 * argument: there are exactly two, they are chosen once, and each one needs a
 * sentence of explanation. A `<select>` hides both sentences behind a click and
 * makes the choice feel incidental, which it is not — nothing in this system
 * changes an account's type after it is opened.
 *
 * The descriptions come from `ACCOUNT_TYPE_PRESENTATION`. The savings one
 * departs from the prototype's "Genera intereses" on purpose: decision D-02
 * gives the types no differentiated rule (TD-017), and a test fails if the
 * word ever comes back.
 */
const model = defineModel<AccountType | null>({ default: null });

const props = withDefaults(defineProps<{ disabled?: boolean }>(), { disabled: false });

const TYPES = Object.entries(ACCOUNT_TYPE_PRESENTATION) as [
  AccountType,
  (typeof ACCOUNT_TYPE_PRESENTATION)[AccountType],
][];
</script>

<template>
  <fieldset class="flex flex-col gap-2" :disabled="props.disabled">
    <legend class="mb-2 text-[13px] font-medium text-[#5A5B63]">Tipo de cuenta</legend>

    <div class="grid gap-2 sm:grid-cols-2">
      <button
        v-for="[value, presentation] in TYPES"
        :key="value"
        type="button"
        :aria-pressed="model === value"
        :data-account-type="value"
        class="cursor-pointer rounded-xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60"
        :class="
          model === value
            ? 'border-[#17191F] bg-[#F0F0F2]'
            : 'border-[#C6C6CC] bg-white hover:border-[#75767F]'
        "
        @click="model = value"
      >
        <span class="block text-[14px] font-semibold text-[#23242A]">
          {{ presentation.label }}
        </span>
        <span class="mt-0.5 block text-[12px] leading-[18px] text-[#5A5B63]">
          {{ presentation.description }}
        </span>
      </button>
    </div>
  </fieldset>
</template>
