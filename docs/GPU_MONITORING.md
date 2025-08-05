# GPU Monitoring Support

This document describes the GPU monitoring functionality added to the sysinfo system.

## Overview

The GPU monitoring feature uses command-line tools to collect GPU metrics across multiple platforms and GPU vendors. Instead of relying on Go modules, it uses `exec.Command` to execute platform-specific GPU monitoring tools.

## Supported Platforms and Tools

### Linux
- **NVIDIA GPUs**: Uses `nvidia-smi` command
  - Collects: GPU utilization, memory usage, memory total, temperature
  - Command: `nvidia-smi --query-gpu=index,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits`

- **AMD GPUs**: Uses `rocm-smi` command
  - Collects: Memory usage, memory total, temperature
  - Command: `rocm-smi --showproductname --showmeminfo vram --showtemp`

### macOS
- Uses multiple commands for comprehensive GPU monitoring:
  - `system_profiler SPDisplaysDataType` - Gets GPU names and VRAM information
  - `iostat` - Attempts to get GPU utilization (if available)
  - `vm_stat` - Gets memory pressure information
  - `sysctl hw.memsize` - Gets system memory for estimation
- Collects: GPU names, estimated utilization, memory usage, memory total
- Automatically detects multiple GPUs (integrated + discrete)
- Estimates GPU memory based on system memory if VRAM info unavailable
- Provides more detailed information than basic system_profiler output

### Windows
- Uses PowerShell commands for comprehensive GPU monitoring:
  - `Get-WmiObject -Class Win32_VideoController` - Gets GPU names and memory information
  - `Get-Counter "\GPU Engine(*)\Utilization Percentage"` - Gets GPU utilization
  - `Get-Counter "\GPU Adapter Memory(*)\Dedicated Usage"` - Gets GPU memory usage
- Collects: GPU names, utilization, memory usage, memory total
- Automatically detects multiple GPUs (integrated + discrete)
- Filters out basic/standard display adapters to focus on dedicated GPUs
- Provides real-time GPU utilization using Windows Performance Counters

## Data Structure

GPU data is collected in the following format:

```go
type GpuData struct {
    Index    int     `json:"index"`     // GPU index
    Util     float64 `json:"util"`      // GPU utilization percentage
    MemUsed  float64 `json:"mem_used"`  // Memory used in GB
    MemTotal float64 `json:"mem_total"` // Total memory in GB
    Temp     float64 `json:"temp"`      // Temperature in Celsius
}
```

## Metrics Collected

The system collects the following metrics for each GPU:

- `gpu` - Average GPU utilization across all GPUs
- `gpu:{index}:util` - GPU utilization for specific GPU
- `gpu:{index}:mem_used` - Memory used for specific GPU
- `gpu:{index}:mem_total` - Total memory for specific GPU
- `gpu:{index}:temp` - Temperature for specific GPU

## Frontend Plot Types

The frontend supports the following GPU-related plot types:

- **GPU**: Shows average GPU utilization
- **All GPU**: Shows utilization for all individual GPUs
- **GPU Memory**: Shows memory usage for all GPUs
- **CPU + GPU**: Shows both CPU and GPU utilization

## Implementation Details

### Platform Detection
The system automatically detects the platform using `uname -s` and selects the appropriate GPU monitoring method.

### Tool Availability Detection
Before attempting to collect GPU data, the system checks if the required tools (`nvidia-smi` or `rocm-smi`) are available on the system.

### macOS Improvements
The macOS implementation has been significantly enhanced to provide more comprehensive GPU monitoring:

1. **Multiple GPU Detection**: Parses `system_profiler` output to detect both integrated and discrete GPUs
2. **VRAM Information**: Extracts VRAM size from system_profiler output using regex patterns
3. **Memory Pressure**: Uses `vm_stat` to calculate memory usage and pressure
4. **GPU Utilization**: Attempts to get GPU utilization from `iostat` output
5. **Memory Estimation**: Falls back to estimating GPU memory based on system memory if VRAM info is unavailable
6. **Error Handling**: Gracefully handles missing commands and parsing errors

### Windows Implementation
The Windows implementation provides comprehensive GPU monitoring using PowerShell:

1. **GPU Detection**: Uses `Get-WmiObject -Class Win32_VideoController` to detect all GPUs
2. **Memory Information**: Extracts adapter RAM size and converts to GB
3. **GPU Utilization**: Uses Windows Performance Counters to get real-time GPU utilization
4. **Memory Usage**: Tracks dedicated GPU memory usage using performance counters
5. **Multi-GPU Support**: Automatically detects and monitors multiple GPUs
6. **Filtering**: Excludes basic/standard display adapters to focus on dedicated GPUs
7. **Error Handling**: Gracefully handles PowerShell execution errors and missing counters

### Error Handling
- If no GPU tools are available, the system gracefully continues without GPU data
- Timeouts are set for all command executions to prevent hanging
- Parsing errors are handled gracefully

### Performance
- GPU data collection is integrated into the existing sysinfo loop
- Commands are executed with timeouts to prevent blocking
- Data is collected every second along with CPU and memory data

## Usage

To use GPU monitoring:

1. Ensure you have the appropriate GPU monitoring tools installed:
   - For NVIDIA: Install NVIDIA drivers (includes `nvidia-smi`)
   - For AMD: Install ROCm (includes `rocm-smi`)

2. The GPU data will automatically appear in sysinfo blocks when available

3. Select GPU plot types from the sysinfo view settings menu

## Testing

Run the tests to verify GPU functionality:

```bash
cd pkg/wshrpc/wshremote
go test -v
```

The tests will check:
- Platform detection
- Tool availability
- GPU data collection

## Future Enhancements

- Windows GPU monitoring support
- More detailed macOS GPU monitoring
- GPU power consumption metrics
- GPU fan speed monitoring
- Support for additional GPU vendors (Intel, etc.) 