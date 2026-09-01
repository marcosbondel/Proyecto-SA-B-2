<script setup lang="ts">
import { formatQuetzales, MIN_AMOUNT_MINOR } from '../../lib/money';
import { mayTakeDeposits } from '../../lib/account';

/**
 * `A-05` — the deposit window, in the four states the prototype draws: the
 * form, the confirmation, the receipt, and the refusal.
 *
 * **The confirmation step is not decoration.** This is the one screen in the
 * system where a mistyped digit moves real money into the wrong account with no
 * counterparty to notice — a transfer at least debits somebody who will see it.
 * So the account and the amount are repeated back, and the button that commits
 * says what it commits.
 *
 * The route answers synchronously, so there is no "pending, come back later"
 * state to render: what the prototype draws as `deposit:pending` is this
 * screen's in-flight button. That is the honest mapping — a spinner for
 * something that takes a second, not a status page for something that takes
 * minutes.
 */
const api = useGatewayApi();
const { role } = useSession();

const allowed = computed(() => mayTakeDeposits(role.value));

const accountId = ref('');
const amountMinor = ref<number | null>(null);
const description = ref('');

type Step = 'FORM' | 'CONFIRM' | 'DONE';

const step = ref<Step>('FORM');
const sending = ref(false);
const failure = ref<string | null>(null);
const correlationId = ref<string | null>(null);

interface Receipt {
  readonly operationId: string;
  readonly balanceAfter: { readonly amountMinor: number; readonly currency: string };
  readonly reactivated: boolean;
  readonly amountMinor: number;
  readonly accountId: string;
}

const receipt = ref<Receipt | null>(null);

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const localProblem = computed(() => {
  if (accountId.value.length > 0 && !UUID_V4.test(accountId.value.trim())) {
    return 'El número de cuenta es el identificador completo (UUID) que aparece en la cuenta.';
  }

  if (amountMinor.value !== null && amountMinor.value < MIN_AMOUNT_MINOR) {
    return 'El monto tiene que ser mayor que cero.';
  }

  return null;
});

const canContinue = computed(
  () =>
    UUID_V4.test(accountId.value.trim()) &&
    amountMinor.value !== null &&
    amountMinor.value >= MIN_AMOUNT_MINOR,
);

function review(): void {
  failure.value = null;
  step.value = 'CONFIRM';
}

async function commit(): Promise<void> {
  if (amountMinor.value === null) {
    return;
  }

  sending.value = true;
  failure.value = null;

  const requested = { account: accountId.value.trim(), amount: amountMinor.value };

  const result = await api.call<{
    depositId: string;
    operationId: string;
    balanceAfter: { amountMinor: number; currency: string };
    reactivated: boolean;
    correlationId: string;
  }>(`/api/accounts/${requested.account}/deposit`, {
    method: 'POST',
    body: {
      amount: { amountMinor: requested.amount, currency: 'GTQ' },
      ...(description.value.trim() === '' ? {} : { description: description.value.trim() }),
    },
  });

  sending.value = false;

  if (result.ok) {
    correlationId.value = result.data.correlationId;
    receipt.value = {
      operationId: result.data.operationId,
      balanceAfter: result.data.balanceAfter,
      reactivated: result.data.reactivated,
      amountMinor: requested.amount,
      accountId: requested.account,
    };
    step.value = 'DONE';
    return;
  }

  correlationId.value = result.error.correlationId;
  step.value = 'FORM';

  /**
   * A timeout is the one failure this screen must not report as "no pasó
   * nada". The deposit may well have landed, and a teller who takes the cash
   * again has just credited the account twice.
   */
  failure.value =
    result.error.type === 'REPLY_TIMEOUT'
      ? 'No recibimos confirmación a tiempo. El depósito PUEDE haberse registrado: consulta el ' +
        'saldo de la cuenta antes de volver a intentarlo.'
      : result.error.message;
}

function again(): void {
  accountId.value = '';
  amountMinor.value = null;
  description.value = '';
  receipt.value = null;
  step.value = 'FORM';
}

useHead({ title: 'Depósito en ventanilla · bonking' });
</script>

<template>
  <section class="flex flex-col gap-6">
    <header>
      <h1 class="text-[32px] font-bold leading-10 tracking-tight">Depósito en ventanilla</h1>
      <p class="mt-1 text-[16px] leading-6 text-[#5A5B63]">
        Efectivo recibido en agencia, acreditado a una cuenta.
      </p>
    </header>

    <UAlert
      v-if="!allowed"
      color="error"
      variant="subtle"
      title="Esta pantalla es para ventanilla"
      description="Solo un cajero receptor o un administrador puede registrar un depósito, así
        que el formulario está oculto. Si necesitas depositar, acércate a una ventanilla."
      data-testid="deposit-forbidden"
    />

    <div v-else class="grid items-start gap-4 lg:grid-cols-[1.4fr_1fr]">
      <UCard v-if="step === 'FORM'">
        <template #header>
          <h2 class="text-[20px] font-semibold leading-7">Datos del depósito</h2>
        </template>

        <form class="flex flex-col gap-4" @submit.prevent="review">
          <UFormField label="Cuenta destino" name="accountId">
            <UInput
              v-model="accountId"
              class="w-full tab"
              placeholder="Pega aquí el número de cuenta"
              required
            />
          </UFormField>

          <SharedMoneyInput label="Monto" name="amount" @update:amount-minor="amountMinor = $event" />

          <UFormField label="Descripción" name="description" hint="Opcional">
            <UInput
              v-model="description"
              class="w-full"
              placeholder="Depósito en efectivo, Agencia Central"
              maxlength="140"
            />
            <!--
              Said out loud because the trail redacts by field name and this
              field is not on that list: whatever is typed here is stored as
              written, and a teller should know that before typing a DPI.
            -->
            <p class="mt-1 text-[12px] leading-4 text-[#75767F]">
              Queda registrada tal como se escribe. No anotes datos personales.
            </p>
          </UFormField>

          <p v-if="localProblem" class="text-[13px] text-[#B01B1B]" data-testid="deposit-local-problem">
            {{ localProblem }}
          </p>

          <UAlert
            v-if="failure"
            color="error"
            variant="subtle"
            title="No se registró el depósito"
            :description="failure"
            data-testid="deposit-failure"
          />

          <UButton type="submit" :disabled="!canContinue" block>Continuar</UButton>
        </form>
      </UCard>

      <UCard v-else-if="step === 'CONFIRM'">
        <template #header>
          <h2 class="text-[20px] font-semibold leading-7">Confirma el depósito</h2>
          <p class="mt-1 text-[14px] text-[#5A5B63]">
            Revisa la cuenta y el monto. Un depósito acreditado no se revierte desde esta pantalla.
          </p>
        </template>

        <dl class="flex flex-col gap-4">
          <div>
            <dt class="text-[12px] text-[#75767F]">Cuenta destino</dt>
            <dd class="tab break-all text-[14px] font-semibold text-[#23242A]">
              {{ accountId.trim() }}
            </dd>
          </div>
          <div>
            <dt class="text-[12px] text-[#75767F]">Monto</dt>
            <dd class="tab text-[32px] font-bold leading-10 tracking-tight text-[#0B0C10]">
              {{ formatQuetzales(amountMinor ?? 0) }}
            </dd>
          </div>
          <div v-if="description.trim()">
            <dt class="text-[12px] text-[#75767F]">Descripción</dt>
            <dd class="text-[14px] text-[#23242A]">{{ description.trim() }}</dd>
          </div>
        </dl>

        <template #footer>
          <div class="flex gap-3">
            <UButton variant="outline" color="neutral" :disabled="sending" @click="step = 'FORM'">
              Volver
            </UButton>
            <UButton class="flex-1" :loading="sending" @click="commit">Registrar depósito</UButton>
          </div>
        </template>
      </UCard>

      <UCard v-else-if="receipt">
        <template #header>
          <h2 class="text-[20px] font-semibold leading-7">Depósito registrado</h2>
        </template>

        <dl class="flex flex-col gap-4">
          <div>
            <dt class="text-[12px] text-[#75767F]">Monto acreditado</dt>
            <dd class="tab text-[32px] font-bold leading-10 tracking-tight text-[#186A32]">
              {{ formatQuetzales(receipt.amountMinor) }}
            </dd>
          </div>
          <div>
            <dt class="text-[12px] text-[#75767F]">Saldo de la cuenta</dt>
            <dd class="tab text-[20px] font-semibold text-[#23242A]">
              {{ formatQuetzales(receipt.balanceAfter.amountMinor) }}
            </dd>
          </div>
          <div>
            <dt class="text-[12px] text-[#75767F]">Cuenta destino</dt>
            <dd class="tab break-all text-[13px] font-medium text-[#23242A]">
              {{ receipt.accountId }}
            </dd>
          </div>
          <div>
            <!--
              `operationId`, not `transactionId`. The prototype labels it the
              latter; a deposit belongs to no transaction, and printing a
              movement's id under a transfer's label on a receipt somebody may
              bring back to a window would be a small lie with real consequences.
            -->
            <dt class="text-[12px] text-[#75767F]">operationId</dt>
            <dd class="tab break-all font-mono text-[12px] font-medium text-[#23242A]">
              {{ receipt.operationId }}
            </dd>
          </div>
        </dl>

        <UAlert
          v-if="receipt.reactivated"
          class="mt-4"
          color="success"
          variant="subtle"
          title="La cuenta volvió a estar activa"
          description="Estaba inactiva y el depósito la reactivó."
          data-testid="deposit-reactivated"
        />

        <template #footer>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex gap-3">
              <UButton @click="again">Registrar otro depósito</UButton>
              <UButton :to="`/cuentas/${receipt.accountId}`" variant="outline" color="neutral">
                Ver la cuenta
              </UButton>
            </div>
            <SharedCorrelationIdBadge :correlation-id="correlationId" />
          </div>
        </template>
      </UCard>

      <UCard>
        <h2 class="text-[14px] font-semibold">Qué hace esta operación</h2>
        <ul class="mt-3 flex list-disc flex-col gap-2 pl-4 text-[13px] leading-5 text-[#5A5B63]">
          <li>
            El dinero <strong class="font-semibold">entra</strong> y no sale de ninguna otra
            cuenta, así que no hay que esperar a nadie: el resultado se sabe de inmediato.
          </li>
          <li>
            Si la cuenta estaba inactiva, el depósito la
            <strong class="font-semibold">reactiva</strong> en lugar de ser rechazado.
          </li>
          <li>
            Volver a intentarlo con el mismo código de operación
            <strong class="font-semibold">no acredita dos veces</strong>: el sistema reconoce que
            es el mismo depósito y responde el movimiento que ya hizo.
          </li>
        </ul>
      </UCard>
    </div>
  </section>
</template>
