<script setup lang="ts">
/**
 * The entry point of the Clientes module.
 *
 * It is a set of doors rather than a list, and the reason is worth stating: the
 * Gateway reads a customer by id but **lists** none, so a table here would
 * either be empty forever or be invented. What it can offer is the commands
 * that do exist — register, update, review an identity — and a way to reach a
 * specific customer by the number a registration hands back.
 *
 * **The doors depend on who is at them.** The module is open to every role,
 * because the Gateway restricts these routes by *scope* and not by role: a
 * client may read their own record, which is the whole of what this module is
 * for them. It used to offer that client "Registrar un cliente" and a lookup
 * box explaining which route the Gateway does not expose — a teller's task and
 * a developer's note, on a screen a cuentahabiente opens by accident. So the
 * cards are filtered here, in the page, which is `docs/FRONTEND.md`'s rule for
 * exactly this case and leaves the navigation matrix — and its parity with the
 * Gateway — untouched.
 */
const { role } = useSession();

const customerId = ref('');

/** Staff register other people and open anybody's file; a client does neither. */
const isStaff = computed(
  () => role.value === 'CAJERO_RECEPTOR' || role.value === 'ADMINISTRADOR',
);

/** The Gateway refuses anything that is not a UUID with a `400`. */
const isValidId = computed(() => /^[0-9a-f-]{36}$/i.test(customerId.value.trim()));

async function open(): Promise<void> {
  if (isValidId.value) {
    await navigateTo(`/clientes/${customerId.value.trim()}`);
  }
}

interface CustomerSummary {
  customerId: string;
  fullName: string;
  email: string;
  username: string;
  documentNumber: string;
  identityStatus: 'PENDING' | 'VALIDATED' | 'REJECTED';
  role: string;
  status: string;
  registeredAt: string;
  /** Fase 2's compliance verdict (T-31). Absent on a reply from before T-26. */
  kycStatus?: 'PENDING' | 'VERIFIED' | 'REJECTED';
}

const api = useGatewayApi();
const customers = ref<CustomerSummary[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

async function loadCustomers(): Promise<void> {
  if (!isStaff.value) return;
  loading.value = true;
  error.value = null;
  const result = await api.call<{ customers: CustomerSummary[]; omitted: number }>('/api/customers?limit=50');
  loading.value = false;
  if (result.ok) {
    customers.value = result.data.customers;
  } else {
    error.value = result.error.message;
  }
}

const copiedId = ref<string | null>(null);

async function copyId(id: string): Promise<void> {
  await navigator.clipboard.writeText(id);
  copiedId.value = id;
  setTimeout(() => {
    copiedId.value = null;
  }, 1500);
}

onMounted(() => {
  loadCustomers();
});

if (role.value === 'CLIENTE') {
  await navigateTo('/perfil');
}

const isAdmin = computed(() => role.value === 'ADMINISTRADOR');

useHead({ title: isAdmin.value ? 'Usuarios · bonking' : 'Clientes · bonking' });
</script>

<template>
  <section class="flex flex-col gap-6">
    <header>
      <h1 class="text-[32px] font-bold leading-10 tracking-tight">
        {{ isAdmin ? 'Usuarios' : 'Clientes' }}
      </h1>
      <p class="mt-1 text-[16px] leading-6 text-[#5A5B63]">
        {{
          isAdmin
            ? 'Directorio de usuarios del sistema: registro con foto, actualización de datos y roles.'
            : 'Registro con foto del documento, actualización de datos y revisión de identidad.'
        }}
      </p>
    </header>

    <div class="grid gap-4 sm:grid-cols-2">
      <UCard v-if="isStaff">
        <h2 class="text-[16px] font-semibold">
          {{ isAdmin ? 'Registrar un usuario' : 'Registrar un cliente' }}
        </h2>
        <p class="mt-2 text-[13px] leading-5 text-[#5A5B63]">
          {{
            isAdmin
              ? 'Alta de nuevo usuario (cliente, cajero o administrador) con foto del DPI y correo de activación.'
              : 'Alta en tres pasos con la foto del DPI. El registro dispara el correo de activación: la cuenta no puede iniciar sesión hasta que se abra ese enlace.'
          }}
        </p>
        <template #footer>
          <UButton to="/clientes/nuevo" color="primary">
            {{ isAdmin ? 'Nuevo usuario' : 'Nuevo cliente' }}
          </UButton>
        </template>
      </UCard>

      <UCard v-if="isStaff">
        <h2 class="text-[16px] font-semibold">Validación de identidad</h2>
        <p class="mt-2 text-[13px] leading-5 text-[#5A5B63]">
          {{
            isAdmin
              ? 'Usuarios registrados que esperan revisión de su documento de identidad.'
              : 'Clientes registrados que esperan revisión de su documento.'
          }}
        </p>
        <template #footer>
          <UButton to="/clientes/validaciones" variant="outline" color="neutral">
            Ver la cola
          </UButton>
        </template>
      </UCard>

      <UCard v-if="isStaff">
        <h2 class="text-[16px] font-semibold">
          {{ isAdmin ? 'Abrir la ficha de un usuario' : 'Abrir la ficha de un cliente' }}
        </h2>
        <p class="mt-2 text-[13px] leading-5 text-[#5A5B63]">
          {{
            isAdmin
              ? 'Ingresa el identificador único (UUID) para consultar o gestionar su expediente en el sistema.'
              : 'Ingresa el identificador único del cliente (UUID) para consultar o gestionar su expediente bancario.'
          }}
        </p>
        <form class="mt-3 flex gap-2" @submit.prevent="open">
          <UInput
            v-model="customerId"
            :placeholder="isAdmin ? 'Pega aquí el número de usuario' : 'Pega aquí el número de cliente'"
            class="flex-1"
            style="font-variant-numeric: tabular-nums lining-nums"
          />
          <UButton type="submit" variant="outline" color="neutral" :disabled="!isValidId">
            Abrir
          </UButton>
        </form>
      </UCard>
    </div>

    <UCard v-if="isStaff" class="mt-2">
      <template #header>
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-[18px] font-bold text-[#23242A]">
              {{ isAdmin ? 'Usuarios registrados' : 'Clientes registrados' }}
            </h2>
            <p class="text-[13px] text-[#5A5B63]">
              {{
                isAdmin
                  ? 'Directorio bancario de usuarios del sistema para consulta y gestión administrativa.'
                  : 'Directorio bancario de expedientes para consulta y operaciones de ventanilla.'
              }}
            </p>
          </div>
          <UButton
            icon="i-lucide-refresh-cw"
            variant="ghost"
            color="neutral"
            size="sm"
            :loading="loading"
            @click="loadCustomers"
          >
            Actualizar
          </UButton>
        </div>
      </template>

      <div v-if="loading && customers.length === 0" class="py-8 text-center text-[#5A5B63]">
        {{ isAdmin ? 'Cargando listado de usuarios…' : 'Cargando listado de clientes…' }}
      </div>
      <div v-else-if="customers.length === 0" class="py-8 text-center text-[#75767F]">
        {{ isAdmin ? 'No hay usuarios registrados en el sistema.' : 'No hay clientes registrados en el sistema.' }}
      </div>
      <div v-else class="overflow-x-auto">
        <table class="w-full text-left text-[13px]">
          <thead class="border-b border-[#E9E9EC] text-[#75767F]">
            <tr>
              <th class="pb-2 font-medium">{{ isAdmin ? 'Usuario / Nombre' : 'Cliente / Nombre' }}</th>
              <th class="pb-2 font-medium">{{ isAdmin ? 'No. Usuario (UUID)' : 'No. Cliente (UUID)' }}</th>
              <th class="pb-2 font-medium">Correo electrónico</th>
              <th class="pb-2 font-medium">Rol</th>
              <th class="pb-2 font-medium">Identidad</th>
              <th class="pb-2 font-medium">KYC</th>
              <th class="pb-2 text-right font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[#E9E9EC]">
            <tr v-for="c in customers" :key="c.customerId" class="hover:bg-neutral-50">
              <td class="py-3 font-medium text-[#23242A]">
                {{ c.fullName }}
                <span class="block text-[11px] text-[#75767F]">@{{ c.username }}</span>
              </td>
              <td class="py-3">
                <div class="flex items-center gap-1.5">
                  <span
                    class="font-mono text-[11px] text-[#5A5B63] select-all"
                    style="font-variant-numeric: tabular-nums lining-nums"
                  >{{ c.customerId }}</span>
                  <UButton
                    size="xs"
                    variant="ghost"
                    color="neutral"
                    :icon="copiedId === c.customerId ? 'i-lucide-check' : 'i-lucide-copy'"
                    :title="copiedId === c.customerId ? 'Copiado' : 'Copiar UUID'"
                    @click="copyId(c.customerId)"
                  />
                </div>
              </td>
              <td class="py-3 text-[#5A5B63]">{{ c.email }}</td>
              <td class="py-3">
                <UBadge variant="subtle" color="neutral" size="sm">{{ c.role }}</UBadge>
              </td>
              <td class="py-3">
                <UBadge
                  :color="c.identityStatus === 'VALIDATED' ? 'success' : c.identityStatus === 'REJECTED' ? 'error' : 'warning'"
                  variant="subtle"
                  size="sm"
                >
                  {{ c.identityStatus === 'VALIDATED' ? 'Verificada' : c.identityStatus === 'REJECTED' ? 'Rechazada' : 'Pendiente' }}
                </UBadge>
              </td>
              <td class="py-3">
                <CustomerKycStatusBadge v-if="c.kycStatus" :status="c.kycStatus" />
                <span v-else class="text-[#75767F]">—</span>
              </td>
              <td class="py-3 text-right">
                <div class="flex flex-col items-end gap-1">
                  <UButton
                    :to="`/clientes/${c.customerId}`"
                    variant="outline"
                    color="neutral"
                    size="xs"
                    class="w-[95px] justify-center text-center"
                  >
                    <span class="w-full text-center">Ficha</span>
                  </UButton>
                  <UButton
                    v-if="c.role === 'CLIENTE'"
                    :to="`/cuentas/nueva?customerId=${c.customerId}`"
                    variant="outline"
                    color="primary"
                    size="xs"
                    class="w-[95px] justify-center text-center leading-tight"
                  >
                    <span class="w-full text-center">Abrir cuenta</span>
                  </UButton>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>
  </section>
</template>
