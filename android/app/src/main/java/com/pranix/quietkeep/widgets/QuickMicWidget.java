package com.pranix.quietkeep.widgets;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

import com.pranix.quietkeep.MainActivity;

/**
 * QuickMicWidget — Track A3 Home Screen Mic Tap Target
 *
 * Provides a 1x1 or 2x2 home screen widget to launch QuietKeep direct to voice capture.
 */
public class QuickMicWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            Intent intent = new Intent(context, MainActivity.class);
            intent.setAction("ACTION_VOICE_MIC_TAP");
            PendingIntent pendingIntent = PendingIntent.getActivity(
                context,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            // Fetch layout resource if exists or default
            int layoutId = context.getResources().getIdentifier("widget_quick_mic", "layout", context.getPackageName());
            if (layoutId != 0) {
                RemoteViews views = new RemoteViews(context.getPackageName(), layoutId);
                int btnId = context.getResources().getIdentifier("btn_quick_mic", "id", context.getPackageName());
                if (btnId != 0) {
                    views.setOnClickPendingIntent(btnId, pendingIntent);
                }
                appWidgetManager.updateAppWidget(appWidgetId, views);
            }
        }
    }
}
