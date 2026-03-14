#include <Wire.h> 
#include <LiquidCrystal_I2C.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// Set the LCD address to 0x27 for a 16 chars and 2 line display
LiquidCrystal_I2C lcd(0x27, 16, 2);

// Pin Definitions
const int ledRed = 13;
const int ledGreen = 14;

// Global States
bool isHighAlert = false;
bool isLowAlert = false;
bool isFindMeMode = false;

// BLE UUIDs
#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

void updateLCD(String line1, String line2) {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(line1);
  lcd.setCursor(0, 1);
  lcd.print(line2);
}

void stopAllAlerts() {
  isHighAlert = false;
  isLowAlert = false;
  isFindMeMode = false;
  digitalWrite(ledRed, LOW);
  digitalWrite(ledGreen, HIGH); // Steady green = system active
  updateLCD("SENSE WATCH", "System Active");
}

// Connection/Disconnection handler
class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      Serial.println("Phone Connected!");
      updateLCD("SENSE WATCH", "Phone Connected");
    };

    void onDisconnect(BLEServer* pServer) {
      Serial.println("Phone Disconnected! Restarting advertising...");
      updateLCD("SENSE WATCH", "Disconnected");
      BLEDevice::startAdvertising(); 
    }
};

// Command handler
class MyCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pCharacteristic) {
      String rxValue = pCharacteristic->getValue(); 

      if (rxValue.length() > 0) {
        char code = rxValue[0];
        Serial.print("Received: ");
        Serial.println(code);

        if (code == 'H') { // HIGH PRIORITY
          isHighAlert = true;
          isLowAlert = false;
          isFindMeMode = false;
          digitalWrite(ledGreen, LOW);
          updateLCD("!! HIGH ALERT !!", "CHECK PHONE NOW");
        } 
        else if (code == 'L') { // LOW PRIORITY
          isLowAlert = true;
          isHighAlert = false;
          isFindMeMode = false;
          digitalWrite(ledRed, LOW);
          updateLCD("* LOW ALERT *", "Check Phone");
        }
        else if (code == 'F') { // FIND MY WATCH
          isFindMeMode = true;
          isHighAlert = false;
          isLowAlert = false;
          updateLCD("FINDING...", "I AM HERE!");
        }
        else if (code == '0') { // STOP FROM APP
          stopAllAlerts();
        }
      }
    }
};

void setup() {
  Serial.begin(115200);
  
  pinMode(ledRed, OUTPUT);
  pinMode(ledGreen, OUTPUT);
  
  // Initialize LCD
  lcd.init();
  lcd.backlight();
  
  // BLE Setup
  BLEDevice::init("SenseNet_Watch");
  BLEServer *pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());
  
  BLEService *pService = pServer->createService(SERVICE_UUID);
  BLECharacteristic *pChar = pService->createCharacteristic(
                                         CHARACTERISTIC_UUID,
                                         BLECharacteristic::PROPERTY_WRITE
                                       );
  
  pChar->setCallbacks(new MyCallbacks());
  pService->start();
  pServer->getAdvertising()->start();
  
  // Starting State
  digitalWrite(ledGreen, HIGH);
  updateLCD("SENSE WATCH", "System Active");
  Serial.println("Device Started. Waiting for Bluetooth...");
}

void loop() {
  // HIGH PRIORITY: Red LED blinks fast
  if (isHighAlert) {
    digitalWrite(ledRed, HIGH);
    delay(300);
    digitalWrite(ledRed, LOW);
    delay(200);
  }

  // LOW PRIORITY: Green LED flashes slow
  if (isLowAlert) {
    digitalWrite(ledGreen, HIGH);
    delay(500);
    digitalWrite(ledGreen, LOW);
    delay(500);
  }

  // FIND ME: Red LED rapid flash
  if (isFindMeMode) {
    digitalWrite(ledRed, HIGH);
    delay(150);
    digitalWrite(ledRed, LOW);
    delay(150);
  }
}
