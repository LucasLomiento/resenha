package com.lucasreis.resenha;

import android.content.Intent;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Ponte entre o app (o estado da call) e o CallService. */
@CapacitorPlugin(name = "CallService")
public class CallServicePlugin extends Plugin {

    private static CallServicePlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    /** A tela do app foi destruída: a página e a call nela acabaram, então a notificação "Na call" sai. */
    @Override
    protected void handleOnDestroy() {
        getContext().stopService(new Intent(getContext(), CallService.class));
        if (instance == this) instance = null;
        super.handleOnDestroy();
    }

    /** Na call: liga (ou atualiza) a notificação; fora: desliga. */
    @PluginMethod
    public void update(PluginCall call) {
        Intent intent = new Intent(getContext(), CallService.class);
        if (!Boolean.TRUE.equals(call.getBoolean("inCall", false))) {
            getContext().stopService(intent);
            call.resolve();
            return;
        }
        for (String key : new String[] { "title", "text", "mute", "leave", "channel" }) intent.putExtra(key, call.getString(key, ""));
        CallService service = CallService.running;
        try {
            if (service != null) service.update(intent);
            else ContextCompat.startForegroundService(getContext(), intent);
            call.resolve();
        } catch (RuntimeException e) {
            call.reject(e.getMessage());
        }
    }

    /** Botão da notificação: vira a ação no app. */
    static void action(String name) {
        if (instance == null) return;
        JSObject data = new JSObject();
        data.put("action", name);
        instance.notifyListeners("action", data);
    }
}
