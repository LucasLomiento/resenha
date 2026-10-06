<script lang="ts">
  import { Icon, StatusDot, type Status } from '../kit'

  const OPTIONS: { status: Status | 'invisible'; label: string; hint?: string }[] = [
    { status: 'online', label: 'Online' },
    { status: 'idle', label: 'Ausente', hint: 'Fica assim sozinho depois de 10 min parado.' },
    { status: 'dnd', label: 'Não perturbe', hint: 'Sem notificações.' },
    { status: 'invisible', label: 'Invisível', hint: 'Aparece offline, mas usa tudo normal.' },
  ]
</script>

<!-- Abre ao clicar no seu avatar no dock. -->
<div class="menu" role="menu" aria-label="Status">
  <button class="custom" role="menuitem">
    <span class="bubble"><Icon name="emoji" size={16} /> Fazendo o app novo</span>
    <Icon name="pencil" size={14} />
  </button>
  <div class="sep"></div>
  {#each OPTIONS as option, i (option.status)}
    <button class="option" class:on={i === 0} role="menuitemradio" aria-checked={i === 0}>
      <StatusDot status={option.status === 'invisible' ? 'offline' : option.status} size={10} cutout="var(--bg-raised)" />
      <span class="text">
        <span class="label">{option.label}</span>
        {#if option.hint}<span class="hint">{option.hint}</span>{/if}
      </span>
      {#if i === 0}<Icon name="check" size={16} />{/if}
    </button>
  {/each}
  <div class="sep"></div>
  <button class="option" role="menuitem">
    <Icon name="user" size={16} />
    <span class="text"><span class="label">Editar perfil</span></span>
  </button>
</div>

<style>
  .menu {
    width: 272px;
    padding: 6px;
    border-radius: var(--r-xl);
    background: var(--bg-raised);
    box-shadow:
      0 0 0 1px var(--line-strong),
      var(--highlight),
      var(--shadow-lg);
  }

  .custom {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 6px 8px;
    border-radius: var(--r-md);
    color: var(--fg-3);
  }

  .custom:hover {
    background: var(--selected);
  }

  .bubble {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: 12px 12px 12px 4px;
    background: rgb(255 255 255 / 0.06);
    color: var(--fg);
    font-size: var(--text-sm);
  }

  .sep {
    height: 1px;
    margin: 6px;
    background: var(--line);
  }

  .option {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    width: 100%;
    padding: 8px 10px;
    border-radius: var(--r-md);
    color: var(--fg-2);
    text-align: left;
  }

  .option:hover {
    background: var(--selected);
  }

  .option :global(.status-dot) {
    margin-top: 5px;
  }

  .option > :global(svg:last-child) {
    margin-top: 2px;
    color: var(--accent-fg);
  }

  .option > :global(svg:first-child) {
    margin-top: 2px;
  }

  .text {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .label {
    color: var(--fg);
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .hint {
    color: var(--fg-3);
    font-size: var(--text-xs);
  }
</style>
