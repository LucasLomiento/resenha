package com.lucasreis.resenha;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationManagerCompat;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

/**
 * O push do Capacitor, mais o "tirar o aviso": a pessoa leu a conversa em outro aparelho (ou no
 * próprio app), e o servidor manda um push só de dados com a etiqueta do aviso. Push só de dados
 * chega aqui mesmo com o app fechado, então o aviso sai da gaveta na hora em que o push chega.
 */
public class PushService extends MessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        String tag = message.getData().get("tag");
        if (message.getNotification() == null && "dismiss".equals(message.getData().get("kind")) && tag != null) {
            // O Firebase mostra o aviso com a etiqueta que o servidor deu e o id 0.
            NotificationManagerCompat.from(this).cancel(tag, 0);
            return;
        }
        super.onMessageReceived(message);
    }
}
