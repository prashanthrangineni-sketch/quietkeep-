package com.pranix.quietkeep.services;

import android.content.Context;
import android.content.Intent;
import android.content.ComponentName;

import org.junit.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

public class MicGuardTest {

    @Test
    public void testStopAariaListenService() {
        Context context = Mockito.mock(Context.class);
        Mockito.when(context.getPackageName()).thenReturn("com.pranix.quietkeep");

        try (org.mockito.MockedConstruction<Intent> mocked = Mockito.mockConstruction(Intent.class)) {
            MicGuard.stopAariaListenService(context);

            assertEquals(1, mocked.constructed().size());
            Intent startedIntent = mocked.constructed().get(0);
            
            Mockito.verify(startedIntent).setClassName(context, "com.pranix.aariaedge.AariaListenService");
            Mockito.verify(startedIntent).setAction("com.pranix.aariaedge.STOP_LISTENING");
            Mockito.verify(context).startService(startedIntent);
        }
    }
}
