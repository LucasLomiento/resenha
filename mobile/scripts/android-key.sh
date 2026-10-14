#!/usr/bin/env bash
# Cria a chave que assina o APK do Resenha e guarda nos secrets do GitHub (ANDROID_KEYSTORE,
# em base64, e ANDROID_KEYSTORE_PASSWORD), pro job "android" do release.yml.
# A senha é gerada aqui e nunca aparece na tela. A chave fica em ~/.local/share/resenha-android
# (release.keystore + release.password): GUARDE UMA CÓPIA. Sem ela, um APK novo não instala
# por cima do antigo (cada pessoa teria que desinstalar e entrar de novo).
#
# Uso: bash mobile/scripts/android-key.sh   (precisa do gh logado e do keytool do JDK)
set -euo pipefail
cd "$(dirname "$0")/../.."

dir="${RESENHA_ANDROID_HOME:-$HOME/.local/share/resenha-android}"
store="$dir/release.keystore"
secret="$dir/release.password"
keytool="${JAVA_HOME:-$dir/jdk}/bin/keytool"
command -v "$keytool" > /dev/null || keytool=keytool
mkdir -p "$dir"

if [ -f "$store" ]; then
  echo "A chave já existe ($store): só reenvia pros secrets."
else
  umask 077
  head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 32 > "$secret"
  RESENHA_PASS="$(cat "$secret")" "$keytool" -genkeypair -keystore "$store" -storetype PKCS12 -alias resenha \
    -keyalg RSA -keysize 4096 -validity 36500 -dname 'CN=Resenha, O=Resenha, C=BR' \
    -storepass:env RESENHA_PASS -keypass:env RESENHA_PASS > /dev/null
  echo "Chave criada em $store (senha em $secret)."
fi

base64 -w0 "$store" | gh secret set ANDROID_KEYSTORE
gh secret set ANDROID_KEYSTORE_PASSWORD < "$secret"
echo "Secrets ANDROID_KEYSTORE e ANDROID_KEYSTORE_PASSWORD guardados no GitHub."
echo "Faça uma cópia de $store e $secret (num lugar seguro, fora do repositório)."
