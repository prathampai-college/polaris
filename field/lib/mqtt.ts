'use client';

const MQTT_BROKER_URL = process.env.NEXT_PUBLIC_MQTT_BROKER_URL || '';
const MQTT_TOPIC_PREFIX = process.env.NEXT_PUBLIC_MQTT_TOPIC_PREFIX || 'polaris/telemetry';

export class MqttPublisher {
  private client: any = null;
  private connected = false;
  private stationId: string;

  constructor(stationId: string) {
    this.stationId = stationId;
  }

  async connect(): Promise<void> {
    if (!MQTT_BROKER_URL || this.client) return;
    try {
      const mqtt = await import('mqtt');
      const clientId = `polaris-field-${this.stationId}-${Date.now()}`;
      this.client = mqtt.default.connect(MQTT_BROKER_URL, {
        clientId,
        protocol: 'ws',
        connectTimeout: 5000,
        reconnectPeriod: 3000,
      });
      this.client.on('connect', () => {
        this.connected = true;
        console.log('[mqtt] field connected');
      });
      this.client.on('error', (err: Error) => {
        console.warn('[mqtt] field error:', err.message);
        this.connected = false;
      });
      this.client.on('close', () => {
        this.connected = false;
      });
    } catch (e) {
      console.warn('[mqtt] field connect failed:', e);
    }
  }

  publishTelemetry(data: Record<string, unknown>): boolean {
    if (!this.client || !this.connected) return false;
    const topic = `${MQTT_TOPIC_PREFIX}/${this.stationId}`;
    this.client.publish(topic, JSON.stringify(data), { qos: 1 });
    return true;
  }

  isConnected(): boolean {
    return this.connected;
  }

  disconnect(): void {
    if (this.client) {
      this.client.end();
      this.client = null;
      this.connected = false;
    }
  }
}
