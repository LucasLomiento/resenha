package com.lucasreis.resenha;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins do próprio app (os do npm o Capacitor acha sozinho).
        registerPlugin(CallServicePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
