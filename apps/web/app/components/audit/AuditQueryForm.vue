<script setup lang="ts">
import { CORRELATION_PROBLEM_TEXT, correlationProblem } from '../../lib/audit';

/**
 * The one input this module has: a `correlationId`.
 *
 * The prototype's `N-02` draws a search box next to three filters — type,
 * service, date — over a global list of every event in the system. **There is
 * no global list here**, and the difference is a property of the route rather
 * than a shortcut: `GET /api/audit` takes a `correlationId` and answers that
 * flow. So the box that was a search is a query, and the three filters moved
 * to the table, where they narrow what came back. Recorded as TD-042.
 *
 * The identifier is validated before it is sent, because a `400` from the
 * Gateway for a mistyped UUID reads like the bank having lost a record. The
 * Gateway still checks; this is the message next to the field.
 *
 * Owned by T-20.
 */
const props = defineProps<{
  modelValue: string;
  /** Disables the button while the previous question is still in flight. */
  busy?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  submit: [correlationId: string];
}>();

/**
 * Nothing is said about an empty box until somebody has tried.
 *
 * A validation message that appears before the first attempt is an interface
 * telling somebody off for not having typed yet.
 */
const attempted = ref(false);

const problem = computed(() => correlationProblem(props.modelValue));
const shownProblem = computed(() => (attempted.value ? problem.value : null));

function submit(): void {
  attempted.value = true;

  if (problem.value === null) {
    emit('submit', props.modelValue.trim());
  }
}
</script>

<template>
  <form class="flex flex-col gap-2" @submit.prevent="submit">
    <label
      for="audit-correlation"
      class="text-[13px] font-medium leading-5 text-[#5A5B63]"
    >Código de seguimiento</label>

    <div class="flex flex-wrap items-start gap-2">
      <div class="flex min-w-[320px] flex-1 flex-col gap-1">
        <UInput
          id="audit-correlation"
          :model-value="modelValue"
          placeholder="7d41e8b2-9a3f-4c15-8ee0-1b2f9a4c7d10"
          autocomplete="off"
          spellcheck="false"
          class="font-mono"
          style="font-variant-numeric: tabular-nums lining-nums"
          :aria-invalid="shownProblem !== null"
          aria-describedby="audit-correlation-help"
          data-testid="audit-correlation-input"
          @update:model-value="emit('update:modelValue', String($event))"
        />
        <p
          v-if="shownProblem"
          class="text-[13px] leading-5 text-[#B01B1B]"
          data-testid="audit-correlation-error"
        >{{ CORRELATION_PROBLEM_TEXT[shownProblem] }}</p>
        <p
          v-else
          id="audit-correlation-help"
          class="text-[13px] leading-5 text-[#75767F]"
        >
          Es el identificador que acompaña a cada operación: aparece en la pantalla de la
          transferencia, en el registro de un pago y en cada aviso de error.
        </p>
      </div>

      <UButton type="submit" color="primary" :disabled="busy" data-testid="audit-submit">
        {{ busy ? 'Consultando…' : 'Consultar' }}
      </UButton>
    </div>
  </form>
</template>
