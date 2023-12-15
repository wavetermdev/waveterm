package releasechecker

import (
	"context"
	"log"

	"github.com/google/go-github/v57/github"
	"golang.org/x/mod/semver"

	"github.com/wavetermdev/waveterm/wavesrv/pkg/scbase"
	"github.com/wavetermdev/waveterm/wavesrv/pkg/sstore"
)

type ReleaseCheckResult int

const (
	NotNeeded ReleaseCheckResult = 0
	Success   ReleaseCheckResult = 1
	Failure   ReleaseCheckResult = 2
	Disabled  ReleaseCheckResult = 3
)

func CheckNewRelease(force bool) (ReleaseCheckResult, error) {
	// Check for the latest release in the DB
	// latestRelease, err := dbutil.g
	ctx := context.Background()
	clientData, err := sstore.EnsureClientData(ctx)
	if !force && clientData.ClientOpts.NoReleaseCheck {
		log.Print("[releasechecker] Release check disabled by user preference")
		return Disabled, nil
	}

	log.Printf("[releasechecker] Existing ReleaseInfo values: %v", clientData.ReleaseInfo)

	if !force && err == nil && clientData.ReleaseInfo.ReleaseAvailable && semver.Compare(scbase.WaveVersion, clientData.ReleaseInfo.InstalledVersion) != 0 {
		// We have already notified the frontend about a new release and the record is fresh. There is no need to check again.
		log.Print("[releasechecker] Release check not needed")
		return NotNeeded, nil
	}
	// Initialize an unauthenticated client
	client := github.NewClient(nil)
	// Get the latest release from the repository
	release, rsp, err := client.Repositories.GetLatestRelease(ctx, "wavetermdev", "waveterm")

	releaseInfoLatest := sstore.ReleaseInfoType{
		ReleaseAvailable: false,
		InstalledVersion: scbase.WaveVersion,
		LatestVersion:    scbase.WaveVersion,
	}

	if err != nil {
		log.Printf("[releasechecker] Error getting latest release: %v", err)
		return Failure, err
	}

	if rsp.StatusCode != 200 {
		log.Printf("[releasechecker] Response from Github is not success: %v", rsp)
		return Failure, nil
	}

	releaseInfoLatest.LatestVersion = *release.TagName
	if semver.Compare(releaseInfoLatest.InstalledVersion, releaseInfoLatest.LatestVersion) < 0 {
		log.Printf("[releasechecker] New release available: %s", releaseInfoLatest.LatestVersion)
		releaseInfoLatest.ReleaseAvailable = true
	}

	// Update the release info in the DB
	log.Printf("[releasechecker] Updating release info: %v", releaseInfoLatest)
	err = sstore.SetReleaseInfo(ctx, releaseInfoLatest)
	if err != nil {
		log.Printf("[releasechecker] Error updating release info: %v", err)
		return Failure, err
	}
	update := &sstore.ModelUpdate{
		ClientData: clientData,
	}
	sstore.MainBus.SendUpdate(update)

	return Success, nil
}
