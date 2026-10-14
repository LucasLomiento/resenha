package com.lucasreis.resenha;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * A call em andamento: um serviço em primeiro plano (a notificação fixa "Na call") deixa o
 * microfone ligado com o app no fundo ou a tela apagada, que o Android corta sem ele.
 * Os botões da notificação voltam pro app como ações (as mesmas da bandeja do computador).
 */
public class CallService extends Service {

    static final String CHANNEL = "call";
    static final int ID = 1;
    /** O serviço rodando agora (pra trocar o texto da notificação sem iniciar de novo). */
    static CallService running;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (action != null) {
            // Botão da notificação: "toggle-mute" ou "leave-call".
            CallServicePlugin.action(action);
            return START_NOT_STICKY;
        }
        running = this;
        Notification notification = build(intent);
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0;
        try {
            ServiceCompat.startForeground(this, ID, notification, type);
        } catch (RuntimeException e) {
            // Sem a permissão do microfone (ou o sistema recusou): a call segue enquanto o app estiver aberto.
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    /** Troca o texto e os botões (mutou, mudou de sala). */
    void update(Intent intent) {
        getSystemService(NotificationManager.class).notify(ID, build(intent));
    }

    private Notification build(Intent intent) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL) == null) {
            // Importância normal (a baixa fica recolhida, sem os botões), mas sem som nem vibração.
            NotificationChannel channel = new NotificationChannel(CHANNEL, extra(intent, "channel", "Call"), NotificationManager.IMPORTANCE_DEFAULT);
            channel.setSound(null, null);
            channel.enableVibration(false);
            channel.setShowBadge(false);
            manager.createNotificationChannel(channel);
        }
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_call)
            .setColor(0xFF2B6CF5)
            .setContentTitle(extra(intent, "title", "Resenha"))
            .setContentText(extra(intent, "text", ""))
            .setOngoing(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(PendingIntent.getActivity(this, 0, open, flags))
            .addAction(0, extra(intent, "mute", ""), button("toggle-mute", 1))
            .addAction(0, extra(intent, "leave", ""), button("leave-call", 2))
            .build();
    }

    private PendingIntent button(String action, int code) {
        Intent intent = new Intent(this, CallService.class).setAction(action);
        return PendingIntent.getService(this, code, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static String extra(Intent intent, String key, String fallback) {
        String value = intent != null ? intent.getStringExtra(key) : null;
        return value != null ? value : fallback;
    }

    @Override
    public void onDestroy() {
        if (running == this) running = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
