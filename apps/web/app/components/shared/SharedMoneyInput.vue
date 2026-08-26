<script setup lang="ts">
import { MIN_AMOUNT_MINOR, amountProblem, toAmountMinor } from '../../lib/money';

/**
 * An amount in quetzales, captured as a decimal and emitted as minor units.
 *
 * The conversion happens here so no module has to remember to multiply by a
 * hundred. Getting that wrong is a silent hundredfold error, and a hundredfold
 * error in a transfer is not a rendering bug.
 *
 * Validation refuses more precision than a centavo rather than rounding it
 * away: silently changing an amount somebody typed is worse than making them
 * retype it.
 */
const model = defineModel<number | null>({ default: null });

const props = withDefaults(
  defineProps<{ label?: string; name?: string; disabled?: boolean }>(),
  { label: 'Monto', name: 'amount', disabled: false },
);

const emit = defineEmits<{ (event: 'update:amountMinor', value: number | null): void }>();

const MESSAGES: Record<string, string> = {
  NOT_A_NUMBER: 'Ingresa un monto válido.',
  TOO_SMALL: `El monto mínimo es Q ${(MIN_AMOUNT_MINOR / 100).toFixed(2)}.`,
  TOO_PRECISE: 'El monto admite como máximo dos decimales.',
};

const problem = computed(() =>
  model.value === null ? null : amountProblem(model.value),
);

const error = computed(() => (problem.value === null ? undefined : MESSAGES[problem.value]));

watch([model, problem], ([value, issue]) => {
  emit('update:amountMinor', value === null || issue !== null ? null : toAmountMinor(value));
});
</script>

<template>
  <UFormField :label="props.label" :name="props.name" :error="error">
    <UInputNumber
      v-model="model"
      :min="MIN_AMOUNT_MINOR / 100"
      :step="0.01"
      :disabled="props.disabled"
      :format-options="{
        style: 'currency',
        currency: 'GTQ',
        currencyDisplay: 'narrowSymbol',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }"
      locale="es-GT"
      class="w-full [font-variant-numeric:tabular-nums_lining-nums]"
    />
  </UFormField>
</template>
