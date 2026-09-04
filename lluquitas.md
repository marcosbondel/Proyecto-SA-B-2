# Análisis de Activación de Cuentas para Roles Staff (Cajeros y Administradores) — Bank USAC

**Archivo de informe técnico solicitado:** `lluquitas.md`  
**Fecha:** 3 de Septiembre de 2026  
**Sistema:** Bank USAC (Plataforma Bancaria Distribuida)

---

## 1. Pregunta Central

> *¿Es necesario que también se tenga que enviar un correo de activación de la cuenta para los cajeros y los administradores?*

**Respuesta Categórica:** **SÍ**.  
Tanto por especificación del **enunciado del proyecto**, como por las reglas del **modelo de dominio (Invariante C-4)** y la arquitectura de seguridad bancaria implementada en el repositorio, **todo usuario** (sea Cliente, Cajero Receptor o Administrador) debe recibir su correo de activación y confirmar su dirección electrónica mediante el token criptográfico antes de que se le permita iniciar sesión (`canSignIn`).

---

## 2. Lo que Dictamina el Enunciado del Proyecto

1. **Flujo Obligatorio de Verificación de Correo (§4.1 Enunciado):**
   * El enunciado especifica que el sistema bancario debe garantizar que toda cuenta creada disponga de un correo electrónico válido, accesible y verificado mediante un enlace de un solo uso con vigencia temporal.
   * La verificación de correo es el mecanismo principal de no-repudio y el canal oficial de entrega de notificaciones de seguridad y transferencias.
2. **Seguridad para Personal Bancario:**
   * Permitir que un cajero o administrador opere en el sistema sin confirmar su correo institucional expondría al banco a suplantación de identidad y creación de cuentas fantasma no rastreables.
   * La recepción del correo de activación acredita que el funcionario tiene control exclusivo de la bandeja receptora corporativa asignada.

---

## 3. Implementación Arquitectónica y Validación en Código

El sistema implementa esta regla de forma estricta e inviolable en tres capas:

### A. Capa de Base de Datos (PostgreSQL — `customer_db`)
En `apps/services/customer-service/src/infrastructure/persistence/migrations.ts` (Migración `001_customers`), existe una restricción de integridad a nivel de motor:
```sql
CONSTRAINT customers_active_iff_verified
  CHECK ((status = 'ACTIVE') = (email_verified_at IS NOT NULL))
```
> **Implicación técnica:** Es físicamente imposible que un registro en la tabla `customers` tenga `status = 'ACTIVE'` si la columna `email_verified_at` es `NULL`. Cualquier intento de autenticación antes de la activación es rechazado.

### B. Capa de Dominio (`customer.entity.ts`)
En la entidad de dominio `Customer`:
```typescript
public get canSignIn(): boolean {
  return this.status === 'ACTIVE';
}
```
* Un usuario recién registrado nace con `status: 'PENDING_ACTIVATION'`.
* El método `canSignIn` retorna `false`, impidiendo la generación de JWT en `AuthenticateCustomerUseCase`.

### C. Generación de Token y Despacho de Eventos (`register-customer.use-case.ts`)
Cuando un administrador crea un nuevo cajero o administrador desde la interfaz web (`/clientes/nuevo`):
1. Se persiste al usuario con rol `CAJERO_RECEPTOR` o `ADMINISTRADOR` y estado `PENDING_ACTIVATION`.
2. Se genera un token criptográfico seguro de 64 caracteres SHA-256 en la tabla `email_activation_tokens`.
3. Se publica el evento de dominio `customer.activation.v1` hacia RabbitMQ.
4. `notification-audit-service` consume el evento y registra la notificación:
   * **Asunto:** *"Activa tu cuenta de bonking"*
   * **Canal:** Email (simulado en el entorno local con registro auditable)
   * **Payload:** Enlace directo de activación con el token asignado.

---

## 4. Evidencia en Vivo Obtenida de la Base de Datos

Al consultar la base de datos de producción/desarrollo tras el registro del cajero **"lucas luquita"** (`probando@bankusac.gt`):

### Consulta SQL en `postgres-customer`:
```sql
SELECT customer_id, full_name, email, role, status, identity_status, email_verified_at
FROM customers
WHERE email = 'probando@bankusac.gt';
```
**Resultado:**
* `customer_id`: `03618920-a7dd-4f6a-ae4d-025a6f4a5161`
* `full_name`: `lucas luquita`
* `email`: `probando@bankusac.gt`
* `role`: **`CAJERO_RECEPTOR`**
* `status`: **`PENDING_ACTIVATION`**
* `identity_status`: `VALIDATED`
* `email_verified_at`: `NULL`

### Consulta SQL en `postgres-notification-audit`:
```sql
SELECT notification_id, type, subject, status, recipient, created_at
FROM notifications
WHERE recipient LIKE '%03618920%';
```
**Resultado:**
* `type`: `customer.activation`
* `subject`: **`Activa tu cuenta de bonking`**
* `status`: `SENT`
* `recipient`: `cliente-03618920@simulado.bonking.gt`

---

## 5. Cuentas Pre-sembradas de Demostración (`seedDemoUsers`)

Para las cuentas precargadas en el archivo de siembra (`admin@bankusac.gt`, `cajero@bankusac.gt`, etc.), el script de bootstrap (`seed-demo-data.ts`) las inserta deliberadamente con:
* `status = 'ACTIVE'`
* `identity_status = 'VALIDATED'`
* `email_verified_at = now()`

Esto permite que los evaluadores puedan iniciar sesión inmediatamente con los actores pre-sembrados sin requerir pasos manuales previos, mientras que **cualquier usuario nuevo creado en vivo (sea cliente o staff)** atraviesa obligatoriamente el flujo completo de activación por correo electrónico según lo estipulado en las bases del proyecto.
