#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>

@interface AppDelegate ()

@property (nonatomic, copy) NSDictionary *reactNativeLaunchOptions;

@end

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  self.automaticallyLoadReactNativeWindow = NO;
  self.reactNativeLaunchOptions = launchOptions;
  self.moduleName = @"FTSdkReactNativeExample";
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};

  return [super application:application didFinishLaunchingWithOptions:launchOptions];
}

- (void)bootstrapReactNativeWithWindowScene:(UIWindowScene *)windowScene
{
  self.window = [[UIWindow alloc] initWithWindowScene:windowScene];
  UIView *rootView = [self.rootViewFactory viewWithModuleName:self.moduleName
                                            initialProperties:self.initialProps
                                                launchOptions:self.reactNativeLaunchOptions];
  UIViewController *controller = [self createRootViewController];
  [self setRootView:rootView toRootViewController:controller];
  self.window.rootViewController = controller;
  [self.window makeKeyAndVisible];
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

@end
