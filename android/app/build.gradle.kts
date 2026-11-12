plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Signaling server WebSocket URL, e.g. the free tunnel address:
//   ./gradlew :app:assembleDebug -PsignalingUrl=wss://example.trycloudflare.com/ws
// Default points at the dev server on the emulator host (port 8443, path /ws).
val signalingUrl: String =
    (project.findProperty("signalingUrl") as String?) ?: "wss://10.0.2.2:8443/ws"

android {
    namespace = "app.familyguide.elder"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.familyguide.elder"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "SIGNALING_URL", "\"$signalingUrl\"")
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // WebRTC (video + DataChannel only; no audio track is ever created).
    implementation("io.getstream:stream-webrtc-android:1.3.10")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
}
