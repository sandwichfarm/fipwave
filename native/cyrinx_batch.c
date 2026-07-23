#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cyrinx/cyrinx_bulk.h"

#define METADATA_BYTES 256u
#define APPLICATION_MAX 1536u
#define PAYLOAD_BYTES 1792u
#define FRAME_SAMPLES 62464u
#define PCM_BYTES (FRAME_SAMPLES * 4u)
#define MAX_CAPTURE_SAMPLES 144000u
#define MAX_CAPTURE_BYTES (MAX_CAPTURE_SAMPLES * 4u)

static int little_endian(void) { const uint16_t value = 1; return *((const uint8_t *)&value) == 1; }
static void put_u32le(uint8_t *out, uint32_t value) { out[0] = (uint8_t)value; out[1] = (uint8_t)(value >> 8); out[2] = (uint8_t)(value >> 16); out[3] = (uint8_t)(value >> 24); }
static uint32_t get_u32le(const uint8_t *in) { return (uint32_t)in[0] | ((uint32_t)in[1] << 8) | ((uint32_t)in[2] << 16) | ((uint32_t)in[3] << 24); }

/* Small self-contained SHA-256 so native metadata cannot be spoofed by its caller. */
typedef struct { uint32_t state[8]; uint64_t bits; uint8_t block[64]; size_t used; } sha256_state;
static const uint32_t sha256_k[64] = { 0x428a2f98u,0x71374491u,0xb5c0fbcfu,0xe9b5dba5u,0x3956c25bu,0x59f111f1u,0x923f82a4u,0xab1c5ed5u,0xd807aa98u,0x12835b01u,0x243185beu,0x550c7dc3u,0x72be5d74u,0x80deb1feu,0x9bdc06a7u,0xc19bf174u,0xe49b69c1u,0xefbe4786u,0x0fc19dc6u,0x240ca1ccu,0x2de92c6fu,0x4a7484aau,0x5cb0a9dcu,0x76f988dau,0x983e5152u,0xa831c66du,0xb00327c8u,0xbf597fc7u,0xc6e00bf3u,0xd5a79147u,0x06ca6351u,0x14292967u,0x27b70a85u,0x2e1b2138u,0x4d2c6dfcu,0x53380d13u,0x650a7354u,0x766a0abbu,0x81c2c92eu,0x92722c85u,0xa2bfe8a1u,0xa81a664bu,0xc24b8b70u,0xc76c51a3u,0xd192e819u,0xd6990624u,0xf40e3585u,0x106aa070u,0x19a4c116u,0x1e376c08u,0x2748774cu,0x34b0bcb5u,0x391c0cb3u,0x4ed8aa4au,0x5b9cca4fu,0x682e6ff3u,0x748f82eeu,0x78a5636fu,0x84c87814u,0x8cc70208u,0x90befffau,0xa4506cebu,0xbef9a3f7u,0xc67178f2u };
static uint32_t rotr(uint32_t value, uint32_t shift) { return (value >> shift) | (value << (32u - shift)); }
static void sha256_transform(sha256_state *s, const uint8_t *block) { uint32_t w[64], a,b,c,d,e,f,g,h,t1,t2; int i; for (i=0;i<16;i++) w[i]=((uint32_t)block[i*4]<<24)|((uint32_t)block[i*4+1]<<16)|((uint32_t)block[i*4+2]<<8)|block[i*4+3]; for (;i<64;i++) w[i]=(rotr(w[i-15],7)^rotr(w[i-15],18)^(w[i-15]>>3))+w[i-16]+(rotr(w[i-2],17)^rotr(w[i-2],19)^(w[i-2]>>10))+w[i-7]; a=s->state[0];b=s->state[1];c=s->state[2];d=s->state[3];e=s->state[4];f=s->state[5];g=s->state[6];h=s->state[7]; for(i=0;i<64;i++){t1=h+(rotr(e,6)^rotr(e,11)^rotr(e,25))+((e&f)^((~e)&g))+sha256_k[i]+w[i];t2=(rotr(a,2)^rotr(a,13)^rotr(a,22))+((a&b)^(a&c)^(b&c));h=g;g=f;f=e;e=d+t1;d=c;c=b;b=a;a=t1+t2;} s->state[0]+=a;s->state[1]+=b;s->state[2]+=c;s->state[3]+=d;s->state[4]+=e;s->state[5]+=f;s->state[6]+=g;s->state[7]+=h; }
static void sha256_init(sha256_state *s) { static const uint32_t initial[8]={0x6a09e667u,0xbb67ae85u,0x3c6ef372u,0xa54ff53au,0x510e527fu,0x9b05688cu,0x1f83d9abu,0x5be0cd19u}; memcpy(s->state,initial,sizeof(initial));s->bits=0;s->used=0; }
static void sha256_update(sha256_state *s, const uint8_t *data, size_t len) { while(len--){s->block[s->used++]=*data++;if(s->used==64){sha256_transform(s,s->block);s->bits+=512;s->used=0;}} }
static void sha256_final(sha256_state *s, uint8_t out[32]) { uint64_t bits=s->bits+(uint64_t)s->used*8; int i; s->block[s->used++]=0x80; if(s->used>56){while(s->used<64)s->block[s->used++]=0;sha256_transform(s,s->block);s->used=0;} while(s->used<56)s->block[s->used++]=0; for(i=7;i>=0;i--)s->block[s->used++]=(uint8_t)(bits>>(i*8));sha256_transform(s,s->block);for(i=0;i<8;i++){out[i*4]=(uint8_t)(s->state[i]>>24);out[i*4+1]=(uint8_t)(s->state[i]>>16);out[i*4+2]=(uint8_t)(s->state[i]>>8);out[i*4+3]=(uint8_t)s->state[i];} }

static size_t read_all(uint8_t *out, size_t cap) {
  size_t used = 0, read_now;
  while (used < cap && (read_now = fread(out + used, 1, cap - used, stdin)) > 0) used += read_now;
  if (ferror(stdin)) return 0;
  if (fgetc(stdin) != EOF) return 0;
  return used;
}

static cyrinx_bulk_config config(void) {
  cyrinx_bulk_config value = {0};
  value.f_lo = 1100.0; value.f_hi = 23000.0; value.pilot_every = 8; value.bits_per_bin = 2;
  value.rate = "1/2"; value.n_sym = 18; value.nfft = 2048; value.cp = 768; value.sr = 48000;
  value.amp = 0.18; value.clip_sigma = 3.3; value.chirp_f0 = 2000.0; value.chirp_f1 = 16000.0;
  return value;
}

static int valid_case_id(const uint8_t *metadata) { size_t i; if (metadata[11] == 0) return 0; for (i=11;i<75 && metadata[i];i++) if (!((metadata[i]>='a'&&metadata[i]<='z')||(metadata[i]>='A'&&metadata[i]<='Z')||(metadata[i]>='0'&&metadata[i]<='9')||metadata[i]=='-'||metadata[i]=='_'||metadata[i]=='.')) return 0; return i < 75; }
static int valid_metadata(const uint8_t *metadata, const uint8_t *application, uint32_t application_bytes) {
  uint8_t digest[32]; sha256_state state;
  if (memcmp(metadata, "CYRX", 4) != 0 || metadata[4] != 1 || get_u32le(metadata + 5) == 0 || metadata[9] > 1 || !valid_case_id(metadata) || get_u32le(metadata + 75) != application_bytes || application_bytes > APPLICATION_MAX) return 0;
  sha256_init(&state); sha256_update(&state, application, application_bytes); sha256_final(&state, digest);
  return memcmp(digest, metadata + 79, sizeof(digest)) == 0;
}

static int geometry(void) {
  cyrinx_bulk_config cfg = config(); cyrinx_bulk_geometry geo = {0};
  if (cyrinx_bulk_compute_geometry(&cfg, &geo) != 0 || geo.payload_bytes != PAYLOAD_BYTES || geo.n_blocks != 7 || geo.frame_samples != FRAME_SAMPLES) return 1;
  printf("{\"payloadBytes\":%d,\"blocks\":%d,\"frameSamples\":%d,\"sampleRate\":48000,\"bitsPerBin\":2,\"rate\":\"1/2\",\"nfft\":2048,\"cp\":768,\"symbols\":18,\"pilotEvery\":8,\"amp\":0.18}\n", geo.payload_bytes, geo.n_blocks, geo.frame_samples);
  return 0;
}

static int encode(void) {
  uint8_t input[4 + METADATA_BYTES + APPLICATION_MAX], payload[PAYLOAD_BYTES];
  float *wave; size_t input_bytes = read_all(input, sizeof(input)); uint32_t application_bytes;
  cyrinx_bulk_config cfg = config(); cyrinx_bulk_geometry geo = {0}; long written;
  if (input_bytes < 4 + METADATA_BYTES || cyrinx_bulk_compute_geometry(&cfg, &geo) != 0) return 1;
  application_bytes = get_u32le(input);
  if (application_bytes > APPLICATION_MAX || input_bytes != 4 + METADATA_BYTES + application_bytes || !valid_metadata(input + 4, input + 4 + METADATA_BYTES, application_bytes)) return 1;
  memset(payload, 0, sizeof(payload)); memcpy(payload, input + 4, METADATA_BYTES); memcpy(payload + METADATA_BYTES, input + 4 + METADATA_BYTES, application_bytes);
  wave = calloc((size_t)geo.frame_samples, sizeof(*wave)); if (!wave) return 1;
  written = cyrinx_bulk_modulate(&cfg, payload, sizeof(payload), wave, (size_t)geo.frame_samples, NULL);
  if (written != geo.frame_samples || fwrite(wave, sizeof(*wave), (size_t)written, stdout) != (size_t)written) { free(wave); return 1; }
  free(wave); return fflush(stdout) == 0 ? 0 : 1;
}

static int decode(void) {
  uint8_t *input = malloc(MAX_CAPTURE_BYTES), payload[PAYLOAD_BYTES], result[4 + 1 + 4 + 4 + 4 + 4 + 4 + 8 + METADATA_BYTES];
  uint8_t block_valid[7]; size_t input_bytes; uint32_t application_bytes; int ok = 0, total = 0, index; double evm = 0.0;
  cyrinx_bulk_config cfg = config(); cyrinx_bulk_geometry geo = {0}; long written;
  if (!input) return 1; input_bytes = read_all(input, MAX_CAPTURE_BYTES);
  if (input_bytes < PCM_BYTES || input_bytes % 4 != 0 || cyrinx_bulk_compute_geometry(&cfg, &geo) != 0) { free(input); return 1; }
  written = cyrinx_bulk_demodulate_with_block_validity(&cfg, (const float *)input, input_bytes / 4, payload, sizeof(payload), &ok, &total, &evm, block_valid, sizeof(block_valid)); free(input);
  if (written != PAYLOAD_BYTES || ok != 7 || total != 7) return 1;
  for (index = 0; index < 7; index++) if (block_valid[index] != 1) return 1;
  application_bytes = get_u32le(payload + 75); if (!valid_metadata(payload, payload + METADATA_BYTES, application_bytes)) return 1;
  memcpy(result, "CYRR", 4); result[4] = 1; put_u32le(result + 5, application_bytes); put_u32le(result + 9, (uint32_t)ok); put_u32le(result + 13, (uint32_t)total); put_u32le(result + 17, 0); put_u32le(result + 21, (uint32_t)((geo.frame_samples * 1000 + cfg.sr - 1) / cfg.sr)); memcpy(result + 25, &evm, sizeof(evm));
  memcpy(result + 33, payload, METADATA_BYTES);
  if (fwrite(result, 1, sizeof(result), stdout) != sizeof(result) || fwrite(payload + METADATA_BYTES, 1, application_bytes, stdout) != application_bytes) return 1;
  return fflush(stdout) == 0 ? 0 : 1;
}

int main(int argc, char **argv) {
  if (argc != 2 || !little_endian()) return 1;
  if (strcmp(argv[1], "geometry") == 0) return geometry();
  if (strcmp(argv[1], "encode") == 0) return encode();
  if (strcmp(argv[1], "decode") == 0) return decode();
  return 1;
}
