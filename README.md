# Guía del Proyecto: Solana Swap 2025

## 📋 Tabla de Contenidos

1. [Introducción](#introducción)
2. [Requisitos Previos](#requisitos-previos)
3. [Instalación y Configuración](#instalación-y-configuración)
4. [Arquitectura del Proyecto](#arquitectura-del-proyecto)
5. [Conceptos Clave de Solana y Anchor](#conceptos-clave-de-solana-y-anchor)
6. [Análisis del Código](#análisis-del-código)
7. [Guía Paso a Paso](#guía-paso-a-paso)
8. [Ejecución de Tests](#ejecución-de-tests)
9. [Ejercicios Prácticos](#ejercicios-prácticos)
10. [Troubleshooting](#troubleshooting)
11. [Recursos Adicionales](#recursos-adicionales)

---

## Introducción

Este proyecto implementa un **sistema de intercambio de tokens (swap)** en la blockchain de Solana utilizando el framework **Anchor**. El programa permite:

- ✅ Crear mercados descentralizados entre dos tokens (Token A y Token B)
- ✅ Establecer precios de intercambio fijos
- ✅ Agregar liquidez mediante depósitos de tokens
- ✅ Realizar intercambios unidireccionales (Token A → Token B)

**Nota**: El swap inverso (Token B → Token A) está pendiente de implementación y puede ser un ejercicio para los estudiantes.

---

## Requisitos Previos

Antes de comenzar, asegúrate de tener instalado:

### Software Necesario

1. **Rust** (versión 1.70.0 o superior)
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. **Solana CLI** (versión 1.18.0 o superior)
   ```bash
   sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
   ```

3. **Anchor Framework** (versión 0.31.0 o superior)
   ```bash
   cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
   avm install latest
   avm use latest
   ```

4. **Node.js y Yarn**
   ```bash
   # Node.js (v18 o superior)
   # Yarn
   npm install -g yarn
   ```

5. **Git**

### Conocimientos Recomendados

- Conceptos básicos de blockchain
- Fundamentos de Rust (tipos, ownership, structs)
- Conceptos básicos de Solana (cuentas, PDAs, programas)
- TypeScript básico (para los tests)

---

## Instalación y Configuración

### 1. Clonar o Preparar el Proyecto

Si ya tienes el proyecto, verifica que estés en el directorio correcto:

```bash
cd solana-swap-2025
```

### 2. Instalar Dependencias

```bash
# Instalar dependencias de Rust
cargo build

# Instalar dependencias de Node.js
yarn install
```

### 3. Configurar Solana CLI

```bash
# Configurar para usar localnet
solana config set --url localhost

# Verificar la configuración
solana config get

# Crear un nuevo keypair si no tienes uno
solana-keygen new
```

### 4. Construir el Programa

```bash
# Construir el programa Anchor
anchor build
```

Este comando:
- Compila el programa Rust
- Genera el ID del programa
- Crea los tipos TypeScript en `target/types/`

### 5. Verificar la Configuración

Abre `Anchor.toml` y verifica:
- El `program_id` debe coincidir con el generado
- El `cluster` debe ser `localnet`
- El `wallet` debe apuntar a tu keypair

---

## Arquitectura del Proyecto

### Estructura de Directorios

```
solana-swap-2025/
├── programs/
│   └── solana-swap-2025/
│       └── src/
│           └── lib.rs          # Código principal del programa
├── tests/
│   └── solana-swap-2025.ts     # Tests en TypeScript
├── migrations/
│   └── deploy.ts               # Script de deployment
├── Anchor.toml                 # Configuración de Anchor
├── Cargo.toml                  # Dependencias de Rust
└── package.json                # Dependencias de Node.js
```

### Componentes Principales

1. **Programa Anchor** (`lib.rs`): Contiene la lógica del smart contract
2. **Tests** (`solana-swap-2025.ts`): Pruebas automatizadas del programa
3. **Configuración** (`Anchor.toml`): Configuración del proyecto

---

## Conceptos Clave de Solana y Anchor

### 1. Program Derived Addresses (PDAs)

Los PDAs son direcciones derivadas determinísticamente que permiten que un programa "posea" cuentas. En este proyecto:

- **Market PDA**: Almacena la información del mercado
- **Vault A PDA**: Bóveda para Token A
- **Vault B PDA**: Bóveda para Token B

```rust
// Ejemplo: Derivar el PDA del mercado
seeds = [b"market", token_mint_a.key().as_ref(), token_mint_b.key().as_ref()]
```

### 2. Cuentas (Accounts)

En Solana, todo se almacena en cuentas:
- **MarketAccount**: Estructura que almacena datos del mercado
- **TokenAccount**: Cuenta de tokens SPL
- **Mint**: Define un token (similar a un ERC20 en Ethereum)

### 3. Contextos (Contexts)

Los contextos en Anchor definen qué cuentas necesita una instrucción:

```rust
#[derive(Accounts)]
pub struct InitializeMarket<'info> {
    // Define todas las cuentas necesarias
}
```

### 4. Instrucciones (Instructions)

Cada función pública en el módulo `#[program]` es una instrucción:

- `initialize_market`: Crea un nuevo mercado
- `set_price`: Actualiza el precio de intercambio
- `add_liquidity`: Agrega tokens a las bóvedas
- `swap`: Intercambia tokens

---

## Análisis del Código

### 1. Estructura de Datos: MarketAccount

```rust
#[account]
#[derive(InitSpace)]
pub struct MarketAccount {
    pub authority: Pubkey,        // Quien puede modificar el mercado
    pub token_mint_a: Pubkey,     // Dirección del Token A
    pub token_mint_b: Pubkey,     // Dirección del Token B
    pub price: u64,               // Precio de intercambio
    pub decimals_a: u8,           // Decimales del Token A
    pub decimals_b: u8,           // Decimales del Token B
    pub bump: u8,                 // Bump seed para el PDA
}
```

**Pregunta para reflexionar**: ¿Por qué necesitamos almacenar los decimales de cada token?

### 2. Inicialización del Mercado

La función `initialize_market` crea:
1. Una cuenta `MarketAccount` (PDA)
2. Una bóveda para Token A (PDA)
3. Una bóveda para Token B (PDA)

**Conceptos importantes**:
- `init`: Crea una nueva cuenta
- `seeds`: Define cómo derivar el PDA
- `bump`: Asegura que el PDA sea válido

### 3. Agregar Liquidez

La función `add_liquidity` transfiere tokens desde las cuentas del `authority` a las bóvedas usando **Cross-Program Invocations (CPI)**.

**Flujo**:
1. Verifica que `amount_a` o `amount_b` sean > 0
2. Transfiere Token A del authority a vault_a (si amount_a > 0)
3. Transfiere Token B del authority a vault_b (si amount_b > 0)

### 4. Swap (Intercambio)

La función `swap` implementa el intercambio A → B:

**Cálculo del precio**:
```rust
amount_b = (amount * price * 10^decimals_b) / (10^6 * 10^decimals_a)
```

**Pasos**:
1. Transfiere Token A del usuario a vault_a
2. Calcula cuántos Token B debe recibir el usuario
3. Transfiere Token B de vault_b al usuario (usando signer seeds)

**Nota**: El swap inverso (B → A) está marcado como TODO.

---

## Guía Paso a Paso

### Paso 1: Entender el Flujo Completo

Antes de escribir código, entiende el flujo:

1. **Setup**: Crear dos tokens (Mint A y Mint B)
2. **Inicializar**: Crear un mercado entre los dos tokens
3. **Configurar Precio**: Establecer el precio de intercambio
4. **Agregar Liquidez**: Depositar tokens en las bóvedas
5. **Swap**: Intercambiar tokens

### Paso 2: Revisar los Tests

Los tests en `tests/solana-swap-2025.ts` muestran cómo usar el programa:

1. **Setup inicial**: Crea tokens, cuentas, y hace airdrop de SOL
2. **Test de inicialización**: Verifica que el mercado se crea correctamente
3. **Test de precio**: Verifica que se puede actualizar el precio
4. **Test de liquidez**: Verifica que se pueden agregar tokens
5. **Test de swap**: Verifica que el intercambio funciona

### Paso 3: Ejecutar los Tests

```bash
# Asegúrate de tener un validador local corriendo
solana-test-validator

# En otra terminal, ejecuta los tests
anchor test
```

### Paso 4: Analizar el Código Rust

Lee `lib.rs` línea por línea y pregunta:

- ¿Qué hace cada struct?
- ¿Por qué se usan PDAs?
- ¿Cómo funcionan los signer seeds?
- ¿Qué es un CPI?

### Paso 5: Implementar el Swap Inverso

**Ejercicio**: Implementa el swap B → A siguiendo el mismo patrón que A → B.

**Pistas**:
- El cálculo del precio será diferente
- Necesitas verificar que el precio no sea cero
- Usa `checked_div` para evitar overflow

---

## Ejecución de Tests

### 1. Iniciar el Validador Local

En una terminal:

```bash
solana-test-validator
```

Este comando inicia un validador de Solana local en `localhost:8899`.

### 2. Ejecutar los Tests

En otra terminal:

```bash
anchor test
```

Este comando:
- Compila el programa
- Despliega el programa al validador local
- Ejecuta los tests en `tests/solana-swap-2025.ts`

### 3. Interpretar los Resultados

Los tests deberían pasar si todo está correctamente implementado. Si fallan:

1. Revisa los mensajes de error
2. Verifica que el validador esté corriendo
3. Asegúrate de que el programa esté compilado

---

## Ejercicios Prácticos

### Ejercicio 1: Implementar Swap Inverso

**Objetivo**: Completar la función `swap` para permitir intercambios B → A.

**Pasos**:
1. En el bloque `else` de la función `swap`, implementa la lógica inversa
2. El cálculo del precio será: `amount_a = (amount * 10^6) / (price * 10^decimals_a / 10^decimals_b)`
3. Asegúrate de manejar errores (precio cero, overflow)
4. Escribe un test para verificar el swap inverso

### Ejercicio 2: Agregar Validaciones

**Objetivo**: Mejorar la seguridad del programa.

**Tareas**:
1. Verificar que solo el `authority` pueda llamar a `set_price`
2. Verificar que `amount_a` y `amount_b` en `add_liquidity` no sean ambos cero
3. Verificar que el vault tenga suficientes tokens antes de hacer swap
4. Agregar validación para evitar swaps de cantidad cero

### Ejercicio 3: Agregar Eventos

**Objetivo**: Emitir eventos para facilitar el seguimiento.

**Tareas**:
1. Define eventos para cada acción (MarketInitialized, PriceSet, LiquidityAdded, SwapExecuted)
2. Emite eventos en cada función correspondiente
3. Escribe tests que verifiquen que los eventos se emiten correctamente

### Ejercicio 4: Mejorar el Cálculo de Precio

**Objetivo**: Revisar y corregir la fórmula de cálculo.

**Tareas**:
1. Analiza la fórmula actual en `swap`
2. Verifica que el cálculo sea correcto matemáticamente
3. Prueba con diferentes valores de decimales
4. Documenta la fórmula

### Ejercicio 5: Crear un Frontend

**Objetivo**: Crear una interfaz web para interactuar con el programa.

**Tareas**:
1. Usa Next.js y TypeScript
2. Conecta con Phantom wallet
3. Permite inicializar mercados, agregar liquidez y hacer swaps
4. Muestra los balances de las bóvedas

---

## Troubleshooting

### Error: "Program account not found"

**Solución**: 
- Asegúrate de haber ejecutado `anchor build`
- Verifica que el validador local esté corriendo
- Ejecuta `anchor deploy` si es necesario

### Error: "Insufficient funds"

**Solución**:
- Los tests hacen airdrop automáticamente
- Si trabajas manualmente, usa: `solana airdrop 2 <PUBKEY>`

### Error: "Account not initialized"

**Solución**:
- Verifica que estés usando los PDAs correctos
- Asegúrate de que el `bump` sea correcto
- Revisa que los `seeds` coincidan

### Error de Compilación en Rust

**Solución**:
- Verifica la versión de Rust: `rustc --version`
- Actualiza Anchor: `avm install latest && avm use latest`
- Limpia y reconstruye: `cargo clean && anchor build`

### Los Tests Fallan

**Solución**:
1. Revisa los logs del validador
2. Verifica que todas las cuentas se creen correctamente
3. Asegúrate de que los balances sean suficientes
4. Revisa que los cálculos de precio sean correctos

---

## Recursos Adicionales

### Documentación Oficial

- [Anchor Documentation](https://www.anchor-lang.com/)
- [Solana Documentation](https://docs.solana.com/)
- [SPL Token Program](https://spl.solana.com/token)

### Tutoriales Recomendados

- [Solana Cookbook](https://solanacookbook.com/)
- [Anchor Book](https://book.anchor-lang.com/)
- [Solana Development Course](https://www.soldev.app/course)

### Herramientas Útiles

- [Solana Explorer](https://explorer.solana.com/)
- [Solana Playground](https://beta.solpg.io/)
- [Anchor Client](https://www.anchor-lang.com/docs/client)

### Comunidad

- [Solana Discord](https://discord.gg/solana)
- [Anchor Discord](https://discord.gg/anchorlang)
- [Stack Overflow - Solana](https://stackoverflow.com/questions/tagged/solana)

---

## Preguntas Frecuentes

### ¿Por qué usar PDAs en lugar de cuentas normales?

Los PDAs permiten que el programa "posea" cuentas sin necesidad de una clave privada, lo que es más seguro y eficiente.

### ¿Qué es el `bump`?

El `bump` es un valor de 1 byte que se usa para derivar un PDA válido. Se calcula automáticamente por Anchor.

### ¿Cómo funciona el cálculo del precio?

El precio se almacena como un entero con 6 decimales. Para calcular la cantidad de salida:
- Multiplicamos la cantidad de entrada por el precio
- Ajustamos por los decimales de ambos tokens
- Dividimos por el factor de decimales del precio (10^6)

### ¿Puedo usar este código en producción?

Este es un proyecto educativo. Para producción, necesitarías:
- Auditoría de seguridad
- Tests más exhaustivos
- Manejo de edge cases
- Optimización de gas fees

---

## Conclusión

Este proyecto te introduce a:
- Desarrollo de programas en Solana
- Uso del framework Anchor
- Manejo de tokens SPL
- Program Derived Addresses (PDAs)
- Cross-Program Invocations (CPIs)

**Próximos Pasos**:
1. Completa los ejercicios propuestos
2. Experimenta con diferentes precios y cantidades
3. Agrega nuevas funcionalidades
4. Crea un frontend para interactuar con el programa

¡Buena suerte con tu proyecto! 🚀


<!-- BEGIN cc:que-se-valora -->
¡Hola! ¡Qué bien que estés trabajando en tu proyecto "Rust Swap"! Para que tengas una idea clara de qué es lo que miraremos con lupa cuando lo corrijamos, te he preparado esta sección. Así sabrás dónde poner el foco.

## 📋 Qué se valora

Aquí te cuento en qué nos fijaremos al revisar tu proyecto:

**Funcionalidad y cumplimiento del enunciado** es, sin duda, lo que más pesa, y aquí veremos si tu programa hace exactamente lo que se pide en el enunciado y si funciona correctamente en todos los escenarios.

Luego, el **Rust idiomático y la calidad del código** tienen un peso importante, y en este punto nos fijaremos en que tu código esté escrito de una forma que sea natural y eficiente en Rust, siguiendo las buenas prácticas del lenguaje.

Finalmente, los **tests y la documentación** también tienen un peso importante, y aquí evaluaremos si has escrito pruebas que cubran bien tu código y si has documentado lo necesario para que cualquiera pueda entenderlo.

Recuerda que el detalle del enunciado es la guía principal para todo, y la evaluación no penalizará por cosas que no se pidan explícitamente en él.
<!-- END cc:que-se-valora -->
