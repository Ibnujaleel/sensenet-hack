#include <Wire.h> 
#include <LiquidCrystal_I2C.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>

// Set the LCD address to 0x27 for a 16 chars and 2 line display
LiquidCrystal_I2C lcd(0x27, 16, 2);

// Pin Definitions
const int motorPin = 5;
const int ledRed = 13;
const int ledGreen = 14;

// Global States
bool isAlertActive = false;
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
  isAlertActive = false;
  isFindMeMode = false;
  digitalWrite(motorPin, LOW);
  digitalWrite(ledRed, LOW);
  digitalWrite(ledGreen, HIGH);
  updateLCD("SENSE WATCH", "System Active");
}

class MyCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pCharacteristic) {
      std::string rxValue = pCharacteristic->getValue();
      if (rxValue.length() > 0) {
        char code = rxValue[0];

        if (code == '1') { // EMERGENCY
          isAlertActive = true;
          isFindMeMode = false;
          digitalWrite(ledGreen, LOW);
          updateLCD("!!! ALARM !!!", "CHECK PHONE");
        } 
        else if (code == 'F') { // FIND MY WATCH
          isFindMeMode = true;
          isAlertActive = false;
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
  
  pinMode(motorPin, OUTPUT);
  pinMode(ledRed, OUTPUT);
  pinMode(ledGreen, OUTPUT);
  
  // Initialize LCD
  lcd.init();
  lcd.backlight();
  
  // BLE Setup
  BLEDevice::init("SenseNet_Watch");
  BLEServer *pServer = BLEDevice::createServer();
  BLEService *pService = pServer->createService(SERVICE_UUID);
  BLECharacteristic *pChar = pService->createCharacteristic(CHARACTERISTIC_UUID, BLECharacteristic::PROPERTY_WRITE);
  
  pChar->setCallbacks(new MyCallbacks());
  pService->start();
  pServer->getAdvertising()->start();
  
  updateLCD("SENSE WATCH", "Connecting...");
  digitalWrite(ledGreen, HIGH);
}

void loop() {
  if (isFindMeMode) {
    digitalWrite(ledRed, HIGH);
    delay(150);
    digitalWrite(ledRed, LOW);
    delay(150);
  }

  if (isAlertActive) {
    digitalWrite(ledRed, HIGH);
    digitalWrite(motorPin, HIGH);
    delay(800);
    digitalWrite(motorPin, LOW);
    digitalWrite(ledRed, LOW);
    delay(200);
  }
}