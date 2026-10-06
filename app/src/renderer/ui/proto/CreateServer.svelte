<script lang="ts">
  import { Avatar, Button, Icon, Modal, TextField } from '../kit'
  import { guilds, user } from './data'

  let { step = 'choose' }: { step?: 'choose' | 'create' | 'join' } = $props()
  let current = $derived(step)
  const preview = guilds[1]
</script>

<!-- O "+" do trilho: criar um servidor ou entrar num com convite, no mesmo lugar. -->
{#if current === 'choose'}
  <Modal title="Novo servidor" description="Crie o seu ou entre num com convite." onclose={() => {}}>
    <div class="choices">
      <button class="choice" onclick={() => (current = 'create')}>
        <span class="choice-icon create"><Icon name="plus" size={24} /></span>
        <span class="choice-text">
          <span class="choice-title">Criar meu servidor</span>
          <span class="choice-sub">Pro seu grupo, do seu jeito.</span>
        </span>
        <Icon name="chevron-right" size={18} />
      </button>
      <button class="choice" onclick={() => (current = 'join')}>
        <span class="choice-icon join"><Icon name="link" size={22} /></span>
        <span class="choice-text">
          <span class="choice-title">Entrar com convite</span>
          <span class="choice-sub">Cole o código ou o link que te mandaram.</span>
        </span>
        <Icon name="chevron-right" size={18} />
      </button>
    </div>
  </Modal>
{:else if current === 'create'}
  <Modal title="Criar servidor" onclose={() => {}}>
    <div class="create">
      <button class="upload" aria-label="Escolher ícone">
        <Icon name="image-plus" size={24} />
        <span>Ícone</span>
      </button>
      <TextField label="Nome do servidor" value="Servidor do Lucas" maxlength={100} />
    </div>
    {#snippet footer()}
      <Button variant="ghost" icon="arrow-left" onclick={() => (current = 'choose')}>Voltar</Button>
      <span class="grow"></span>
      <Button variant="primary">Criar</Button>
    {/snippet}
  </Modal>
{:else}
  <Modal title="Entrar com convite" onclose={() => {}}>
    <TextField label="Convite ou link" mono value="resenha.app/c/RPG-SABADO" />
    <div class="preview">
      <Avatar id={preview.id} name={preview.name} size={52} square />
      <div class="preview-text">
        <span class="preview-name">{preview.name}</span>
        <span class="preview-meta"><span class="online-dot"></span>5 online · 12 membros</span>
        <span class="preview-by">Convite de {user('u-thiago').name}</span>
      </div>
    </div>
    {#snippet footer()}
      <Button variant="ghost" icon="arrow-left" onclick={() => (current = 'choose')}>Voltar</Button>
      <span class="grow"></span>
      <Button variant="primary">Entrar no servidor</Button>
    {/snippet}
  </Modal>
{/if}

<style>
  .choices {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .choice {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 14px 14px 14px;
    border-radius: var(--r-xl);
    background: rgb(255 255 255 / 0.035);
    box-shadow: inset 0 0 0 1px var(--line);
    color: var(--fg-3);
    text-align: left;
    transition:
      background-color var(--t-fast) var(--ease),
      box-shadow var(--t-fast) var(--ease);
  }

  .choice:hover {
    background: rgb(255 255 255 / 0.06);
    box-shadow: inset 0 0 0 1px var(--line-strong);
    color: var(--fg-2);
  }

  .choice-icon {
    display: grid;
    place-items: center;
    flex: none;
    width: 48px;
    height: 48px;
    border-radius: 14px;
    color: #fff;
  }

  .choice-icon.create {
    background: var(--brand-gradient);
  }

  .choice-icon.join {
    background: linear-gradient(135deg, #36d6ad, #36a9dd);
  }

  .choice-text {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .choice-title {
    color: var(--fg);
    font-weight: 600;
  }

  .choice-sub {
    color: var(--fg-3);
    font-size: var(--text-sm);
  }

  .create {
    display: flex;
    align-items: flex-end;
    gap: 16px;
  }

  .create :global(.field) {
    flex: 1;
  }

  .upload {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    flex: none;
    width: 84px;
    height: 84px;
    border: 1.5px dashed var(--line-strong);
    border-radius: 24px;
    color: var(--fg-3);
    font-size: var(--text-xs);
    font-weight: 500;
  }

  .upload:hover {
    border-color: var(--accent-line);
    color: var(--accent-fg);
  }

  .grow {
    flex: 1;
  }

  .preview {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-top: 16px;
    padding: 14px;
    border-radius: var(--r-xl);
    background: rgb(255 255 255 / 0.035);
    box-shadow: inset 0 0 0 1px var(--line);
  }

  .preview-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .preview-name {
    font-size: var(--text-lg);
    font-weight: 650;
  }

  .preview-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--fg-2);
    font-size: var(--text-sm);
  }

  .online-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--green);
  }

  .preview-by {
    color: var(--fg-3);
    font-size: var(--text-xs);
  }
</style>
