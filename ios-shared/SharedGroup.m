// Bridges the keyboard extension and the React Native runtime via App Group +
// Darwin notifications.
//
// - Keyboard posts Darwin "recordStart" / "recordStop"; we re-emit those to JS
//   via NativeEventEmitter so the host app can drive its expo-av recorder while
//   the user stays in the host text app.
// - Host app posts a heartbeat into the App Group on a timer; the keyboard
//   reads that timestamp to decide whether to use the hot path (signal) or the
//   cold path (open URL to launch the app).
// - When transcription completes, JS calls writeTranscript, which posts the
//   "transcriptReady" Darwin signal that the keyboard observes to insert text.

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <Foundation/Foundation.h>

static NSString *const kAppGroup = @"group.com.opennib.mobile";
static NSString *const kTranscriptKey = @"com.opennib.mobile.lastTranscript";
static NSString *const kCounterKey = @"com.opennib.mobile.transcriptCounter";
static NSString *const kHeartbeatKey = @"com.opennib.mobile.appAliveAt";
static NSString *const kKeyboardActivatedKey = @"com.opennib.mobile.keyboardEverActivated";
// Live mic level (0..1) + write time, published by the host at ~12 fps while a
// keyboard-triggered recording runs. The keyboard's waveform reads it; a
// stale timestamp means the host stopped publishing.
static NSString *const kAudioLevelKey = @"com.opennib.mobile.audioLevel";
static NSString *const kAudioLevelAtKey = @"com.opennib.mobile.audioLevelAt";
static CFStringRef const kTranscriptDarwin = CFSTR("com.opennib.mobile.transcriptReady");
static CFStringRef const kRecordStartDarwin = CFSTR("com.opennib.mobile.recordStart");
static CFStringRef const kRecordStopDarwin = CFSTR("com.opennib.mobile.recordStop");

@interface SharedGroup : RCTEventEmitter <RCTBridgeModule>
@end

static void SharedGroupDarwinCallback(CFNotificationCenterRef center,
                                       void *observer,
                                       CFNotificationName name,
                                       const void *object,
                                       CFDictionaryRef userInfo);

@implementation SharedGroup {
  BOOL _hasJSListeners;
}

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

- (instancetype)init {
  if ((self = [super init])) {
    _hasJSListeners = NO;
    CFNotificationCenterRef center = CFNotificationCenterGetDarwinNotifyCenter();
    CFNotificationCenterAddObserver(center,
                                    (__bridge const void *)(self),
                                    SharedGroupDarwinCallback,
                                    kRecordStartDarwin,
                                    NULL,
                                    CFNotificationSuspensionBehaviorDeliverImmediately);
    CFNotificationCenterAddObserver(center,
                                    (__bridge const void *)(self),
                                    SharedGroupDarwinCallback,
                                    kRecordStopDarwin,
                                    NULL,
                                    CFNotificationSuspensionBehaviorDeliverImmediately);
  }
  return self;
}

- (void)dealloc {
  CFNotificationCenterRemoveObserver(CFNotificationCenterGetDarwinNotifyCenter(),
                                     (__bridge const void *)(self),
                                     NULL,
                                     NULL);
}

- (NSArray<NSString *> *)supportedEvents {
  return @[ @"recordStart", @"recordStop" ];
}

- (void)startObserving {
  _hasJSListeners = YES;
}

- (void)stopObserving {
  _hasJSListeners = NO;
}

- (void)deliverDarwin:(NSString *)name {
  if (!_hasJSListeners) return;
  if ([name isEqualToString:@"com.opennib.mobile.recordStart"]) {
    [self sendEventWithName:@"recordStart" body:nil];
  } else if ([name isEqualToString:@"com.opennib.mobile.recordStop"]) {
    [self sendEventWithName:@"recordStop" body:nil];
  }
}

- (NSUserDefaults *)defaults {
  return [[NSUserDefaults alloc] initWithSuiteName:kAppGroup];
}

RCT_EXPORT_METHOD(writeTranscript:(NSString *)text
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  NSUserDefaults *defaults = [self defaults];
  if (defaults == nil) {
    reject(@"no_app_group", [NSString stringWithFormat:@"Could not open shared UserDefaults for %@", kAppGroup], nil);
    return;
  }
  NSInteger counter = [defaults integerForKey:kCounterKey] + 1;
  [defaults setObject:text forKey:kTranscriptKey];
  [defaults setInteger:counter forKey:kCounterKey];
  [defaults synchronize];
  CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(),
                                       kTranscriptDarwin,
                                       NULL,
                                       NULL,
                                       true);
  resolve(@(counter));
}

// Fire-and-forget: no synchronize — cfprefsd propagates suite writes to the
// extension quickly enough for a 12 fps animation, and forcing a flush per
// frame is what we must not do.
RCT_EXPORT_METHOD(writeAudioLevel:(double)level) {
  NSUserDefaults *defaults = [self defaults];
  if (defaults == nil) return;
  [defaults setDouble:level forKey:kAudioLevelKey];
  [defaults setDouble:[[NSDate date] timeIntervalSince1970] forKey:kAudioLevelAtKey];
}

RCT_EXPORT_METHOD(heartbeat:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  NSUserDefaults *defaults = [self defaults];
  if (defaults == nil) {
    resolve([NSNull null]);
    return;
  }
  [defaults setDouble:[[NSDate date] timeIntervalSince1970] forKey:kHeartbeatKey];
  [defaults synchronize];
  resolve([NSNull null]);
}

// Returns YES if the keyboard extension has ever been displayed inside a host
// app — set by KeyboardViewController.viewDidAppear. The host app uses this to
// distinguish "added but never used" from "fully installed" so the home banner
// stops nagging once the user has completed setup once.
RCT_EXPORT_METHOD(readKeyboardActivated:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
  NSUserDefaults *defaults = [self defaults];
  if (defaults == nil) {
    resolve(@NO);
    return;
  }
  resolve(@([defaults boolForKey:kKeyboardActivatedKey]));
}

@end

static void SharedGroupDarwinCallback(CFNotificationCenterRef center,
                                       void *observer,
                                       CFNotificationName name,
                                       const void *object,
                                       CFDictionaryRef userInfo) {
  SharedGroup *self_ = (__bridge SharedGroup *)observer;
  NSString *raw = (__bridge NSString *)name;
  dispatch_async(dispatch_get_main_queue(), ^{
    [self_ deliverDarwin:raw];
  });
}
