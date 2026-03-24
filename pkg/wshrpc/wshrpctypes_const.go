// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// types and methods for wsh rpc calls
package wshrpc

const (
	// MaxFileSize is the maximum file size that can be read
	MaxFileSize = 50 * 1024 * 1024 // 50M
	// MaxDirSize is the maximum number of entries that can be read in a directory
	MaxDirSize = 5000
	// FileChunkSize is the size of the file chunk to read
	FileChunkSize = 64 * 1024
	// DirChunkSize is the size of the directory chunk to read
	DirChunkSize = 128
)

const LocalConnName = "local"

const (
	RpcType_Call             = "call"             // single response (regular rpc)
	RpcType_ResponseStream   = "responsestream"   // stream of responses (streaming rpc)
	RpcType_StreamingRequest = "streamingrequest" // streaming request
	RpcType_Complex          = "complex"          // streaming request/response
)

const (
	CreateBlockAction_Replace    = "replace"
	CreateBlockAction_SplitUp    = "splitup"
	CreateBlockAction_SplitDown  = "splitdown"
	CreateBlockAction_SplitLeft  = "splitleft"
	CreateBlockAction_SplitRight = "splitright"
)

// we only need consts for special commands handled in the router or
// in the RPC code / WPS code directly.  other commands go through the clients
const (
	Command_Authenticate                 = "authenticate"                 // $control
	Command_AuthenticateToken            = "authenticatetoken"            // $control
	Command_AuthenticateTokenVerify      = "authenticatetokenverify"      // $control:root (internal, for token validation only)
	Command_AuthenticateJobManagerVerify = "authenticatejobmanagerverify" // $control:root (internal, for job auth token validation only)
	Command_RouteAnnounce                = "routeannounce"                // $control (for routing)
	Command_RouteUnannounce              = "routeunannounce"              // $control (for routing)
	Command_Ping                         = "ping"                         // $control
	Command_ControllerInput              = "controllerinput"
	Command_EventRecv                    = "eventrecv"
	Command_Message                      = "message"
	Command_StreamData                   = "streamdata"
	Command_StreamDataAck                = "streamdataack"
)
