# ENUNCIADO — Solana Swap (Anchor)

## Qué tienes que construir

Un **sistema de intercambio de tokens (swap)** en Solana con Anchor: mercados entre dos tokens con precio fijo, depósito de liquidez e intercambios. El `README.md` de este directorio es la guía completa con conceptos, análisis del código de referencia y troubleshooting.

## Requisitos funcionales

1. **Crear mercado** entre Token A y Token B con un precio de intercambio fijo.
2. **Agregar liquidez**: depositar tokens A y B en las bóvedas del mercado (cuentas PDA).
3. **Swap A → B**: intercambio al precio fijado, moviendo tokens entre el usuario y las bóvedas.
4. **Ejercicio principal — Swap B → A**: el intercambio inverso NO está en la referencia; implementarlo es parte obligatoria de tu trabajo.

## Requisitos técnicos

- Rust + Anchor (0.31+), SPL Token, PDAs para el mercado y sus bóvedas.
- Transferencias con CPI a `token::transfer` firmadas con seeds del PDA.
- Errores personalizados: liquidez insuficiente, mercado inexistente, importe cero.
- Tests TypeScript (Mocha/Chai): creación de mercado, liquidez, swap A→B, swap B→A y casos de error.

## Plan de trabajo

- [ ] Entorno: Rust, Solana CLI, Anchor, yarn; `solana config set --url localhost`.
- [ ] Estudiar el diseño de cuentas del README (mercado, bóvedas, PDAs).
- [ ] Implementar `create_market`, `add_liquidity`, `swap_a_to_b`.
- [ ] Implementar `swap_b_to_a` (ejercicio obligatorio).
- [ ] Tests completos con `anchor test`.
- [ ] Ejercicios prácticos adicionales del README (opcional).

## Entregables

1. Repositorio Anchor completo con programa y tests.
2. `anchor test` en verde incluyendo el swap inverso.
3. README propio documentando el diseño de cuentas y cómo ejecutarlo.

## Evaluación

| Criterio | Peso |
|---|---|
| Mercado + liquidez con PDAs correctos | 30% |
| Swap A→B funcionando | 20% |
| Swap B→A (ejercicio propio) | 30% |
| Tests y documentación | 20% |
