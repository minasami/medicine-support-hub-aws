package com.medicinesupporthub.app;

import static org.junit.Assert.fail;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class StartupSmokeTest {
    @Test
    public void packagedInterfaceStartsAndSurvivesRecreation() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitInterface(scenario);
            scenario.recreate();
            awaitInterface(scenario);
        }
    }

    private void awaitInterface(ActivityScenario<MainActivity> scenario) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(45);
        AtomicReference<String> state = new AtomicReference<>("WebView did not respond");
        while (System.nanoTime() < deadline) {
            CountDownLatch response = new CountDownLatch(1);
            scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(
                "(function(){var b=document.getElementById('msh-boot');" +
                "return !b && document.querySelector('header') && document.getElementById('main-content')" +
                " ? 'ready' : (b ? b.innerText : 'Application interface missing');})()",
                result -> { state.set(result); response.countDown(); }));
            if (response.await(2, TimeUnit.SECONDS) && "\"ready\"".equals(state.get())) return;
            Thread.sleep(250);
        }
        fail("Packaged app did not start: " + state.get());
    }
}
