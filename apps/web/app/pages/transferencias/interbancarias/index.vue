<script setup lang="ts">
import { asyncStateFor } from '../../../lib/gateway-error';
import type { LoadState } from '../../../lib/gateway-error';
import {
  ALL_STATES,
  INTERBANK_LIST_LIMIT,
  interbankListQuery,
  interbankStateFilterOptions,
} from '../../../lib/interbank-deposit';
import type { InterbankSendView, InterbankStateFilter } from '../../../lib/interbank-deposit';

/**
 * Los depósitos enviados a otro banco, con el estado que el otro banco les dio
 * (T-60, B10 / TD-090).
 *
 * Hasta aquí el único seguimiento de un depósito interbancario era el de la
 * Saga (`/transferencias/[id]`), que no conoce los seis estados del depósito.
 * Esta pantalla es el listado y `[id].vue` es el detalle.
 *
 * Quién ve qué no se decide aquí: un `CLIENTE` recibe sus depósitos y el
 * personal recibe todos, porque Payment acota la respuesta con la identidad del
 * sobre. Esta pantalla sólo cambia las palabras (`isStaff`), y por eso no hay un
 * `mayX` en `app/lib/` ni una entrada nueva en la navegación: `/transferencias`
 * ya la abre cualquier rol y la restricción real está fila por fila.
 *
 * Hay dos estados vacíos distintos a propósito, igual que en el historial de
 * transferencias: «no has enviado ninguno» tranquiliza, «ninguno tiene ese
 * estado» invita a probar otro filtro, y confundirlos haría que alguien vuelva a
 * revisar que su dinero se movió.
 */
const api = useGatewayApi();
const { role } = useSession();

const isStaff = computed(() => role.value !== null && role.value !== 'CLIENTE');

const rows = ref<readonly InterbankSendView[]>([]);
const state = ref<LoadState>('LOADING');
const failure = ref<string | null>(null);
const correlationId = ref<string | null>(null);

/** `'TODOS'`, no `''`: un `USelect` con un item de valor vacío no abre nunca. */
const filter = ref<InterbankStateFilter>(ALL_STATES);
/** Copiada a un arreglo mutable: `USelect` no acepta uno de sólo lectura. */
const options = [...interbankStateFilterOptions()];

const filtered = computed(() => filter.value !== ALL_STATES);

/**
 * La última petición que cuenta. Cambiar el filtro dos veces seguidas lanza dos
 * consultas, y la que termina última no tiene por qué ser la que se pidió
 * última: sin esto, un listado lento pisaría al correcto.
 */
let latest = 0;

async function load(): Promise<void> {
  const mine = ++latest;

  state.value = 'LOADING';
  failure.value = null;

  const result = await api.call<{ sends: InterbankSendView[]; correlationId: string }>(
    '/api/interbank/transfers',
    { query: interbankListQuery(filter.value) },
  );

  if (mine !== latest) {
    return;
  }

  if (!result.ok) {
    correlationId.value = result.error.correlationId;
    failure.value = result.error.message;
    state.value = asyncStateFor(result.error);

    return;
  }

  rows.value = result.data.sends;
  correlationId.value = result.data.correlationId ?? result.correlationId;
  state.value = 'READY';
}

function clearFilter(): void {
  filter.value = ALL_STATES;
}

onMounted(load);
watch(filter, load);

useHead({ title: 'Depósitos a otros bancos · bonking' });
</script>

<template>
  <section class="flex flex-col gap-6">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-[32px] font-bold leading-10 tracking-tight">
          {{ isStaff ? 'Depósitos a otros bancos' : 'Mis depósitos a otro banco' }}
        </h1>
        <p class="mt-1 max-w-[62ch] text-[16px] leading-6 text-[#5A5B63]">
          {{
            isStaff
              ? 'Los depósitos que los clientes enviaron al banco con el que este banco tiene convenio, y lo que ese banco respondió.'
              : 'Cada depósito que enviaste al banco con el que este banco tiene convenio, y lo que ese banco respondió.'
          }}
        </p>
      </div>
      <div class="flex flex-wrap gap-3">
        <UButton to="/transferencias" variant="outline" color="neutral">Todas las transferencias</UButton>
        <UButton to="/transferencias/interbancaria" color="primary" size="lg">
          Nuevo depósito a otro banco
        </UButton>
      </div>
    </header>

    <UCard>
      <template #header>
        <div class="flex flex-col gap-3">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 class="text-[20px] font-semibold leading-7">Historial</h2>
            <!-- Dice lo que no está mostrando, en vez de dejar creer que 50 es todo. -->
            <p
              v-if="state === 'READY' && rows.length >= INTERBANK_LIST_LIMIT"
              class="tab text-[13px] text-[#75767F]"
              data-testid="interbank-limit-note"
            >
              Mostrando los {{ INTERBANK_LIST_LIMIT }} más recientes
            </p>
          </div>

          <div class="flex flex-wrap items-end gap-3">
            <USelect
              v-model="filter"
              class="w-[240px] max-w-full"
              :items="options"
              value-key="value"
              aria-label="Filtrar por estado del depósito"
              data-testid="interbank-state-filter"
            />
            <UButton
              v-if="filtered"
              variant="ghost"
              color="neutral"
              data-testid="interbank-clear-filter"
              @click="clearFilter"
            >Limpiar filtro</UButton>
          </div>
        </div>
      </template>

      <div v-if="state === 'LOADING'" class="flex flex-col gap-2" data-testid="interbank-loading">
        <USkeleton v-for="line in 4" :key="line" class="h-12 w-full rounded-xl" />
      </div>

      <SharedAsyncStateAlert
        v-else-if="state !== 'READY'"
        :state="state"
        :message="failure"
        :correlation-id="correlationId"
        @retry="load"
      />

      <div
        v-else-if="rows.length === 0 && filtered"
        class="py-10 text-center"
        data-testid="interbank-empty-filtered"
      >
        <p class="text-[20px] font-semibold leading-7">Ningún depósito tiene ese estado</p>
        <p class="mx-auto mt-2 max-w-[46ch] text-[14px] leading-[22px] text-[#5A5B63]">
          Prueba con otro estado, o quita el filtro para ver todos los depósitos.
        </p>
        <UButton variant="outline" color="neutral" class="mt-6" @click="clearFilter">
          Limpiar filtro
        </UButton>
      </div>

      <div v-else-if="rows.length === 0" class="py-10 text-center" data-testid="interbank-empty">
        <p class="text-[20px] font-semibold leading-7">
          {{ isStaff ? 'No hay depósitos a otros bancos' : 'Todavía no enviaste depósitos a otro banco' }}
        </p>
        <p class="mx-auto mt-2 max-w-[46ch] text-[14px] leading-[22px] text-[#5A5B63]">
          {{
            isStaff
              ? 'Cuando un cliente envíe un depósito al banco con el que hay convenio, aparecerá aquí con su estado.'
              : 'Cuando envíes uno, aparecerá aquí con su estado. Si acabas de enviarlo, puede tardar unos segundos en aparecer.'
          }}
        </p>
        <UButton to="/transferencias/interbancaria" color="primary" class="mt-6">
          {{ isStaff ? 'Registrar un depósito' : 'Enviar un depósito' }}
        </UButton>
      </div>

      <TransactionInterbankTable v-else :rows="rows" />

      <template #footer>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <UButton
            variant="ghost"
            color="neutral"
            :disabled="state === 'LOADING'"
            data-testid="interbank-refresh"
            @click="load"
          >Actualizar</UButton>
          <SharedCorrelationIdBadge :correlation-id="correlationId" />
        </div>
      </template>
    </UCard>
  </section>
</template>
