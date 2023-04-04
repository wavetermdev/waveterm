import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import {v4 as uuidv4} from "uuid";
import dayjs from "dayjs";
import {If, For, When, Otherwise, Choose} from "tsx-control-statements/components";
import cn from "classnames";
import type {BookmarkType} from "./types";
import {GlobalModel, GlobalCommandRunner} from "./model";
import {CmdStrCode, Markdown} from "./elements";

@mobxReact.observer
class Bookmark extends React.Component<{bookmark : BookmarkType}, {}> {
    @boundMethod
    handleDeleteClick() : void {
        let {bookmark} = this.props;
        let model = GlobalModel.bookmarksModel;
        model.handleDeleteBookmark(bookmark.bookmarkid);
    }

    @boundMethod
    handleEditClick() : void {
        let {bookmark} = this.props;
        let model = GlobalModel.bookmarksModel;
        model.handleEditBookmark(bookmark.bookmarkid);
    }

    @boundMethod
    handleEditCancel() : void {
        let model = GlobalModel.bookmarksModel;
        model.cancelEdit();
        return;
    }

    @boundMethod
    handleEditUpdate() : void {
        let model = GlobalModel.bookmarksModel;
        model.confirmEdit();
        return;
    }

    @boundMethod
    handleDescChange(e : any) : void {
        let model = GlobalModel.bookmarksModel;
        mobx.action(() => {
            model.tempDesc.set(e.target.value);
        })();
    }

    @boundMethod
    handleCmdChange(e : any) : void {
        let model = GlobalModel.bookmarksModel;
        mobx.action(() => {
            model.tempCmd.set(e.target.value);
        })();
    }

    @boundMethod
    handleClick() : void {
        let {bookmark} = this.props;
        let model = GlobalModel.bookmarksModel;
        model.selectBookmark(bookmark.bookmarkid);
    }

    @boundMethod
    handleUse() : void {
        let {bookmark} = this.props;
        let model = GlobalModel.bookmarksModel;
        model.useBookmark(bookmark.bookmarkid);
    }

    @boundMethod
    clickCopy() : void {
        let bm = this.props.bookmark;
        let model = GlobalModel.bookmarksModel;
        model.handleCopyBookmark(bm.bookmarkid);
    }
    
    render() {
        let bm = this.props.bookmark;
        let model = GlobalModel.bookmarksModel;
        let isSelected = (model.activeBookmark.get() == bm.bookmarkid);
        let markdown = bm.description ?? "";
        let hasDesc = markdown != "";
        let isEditing = (model.editingBookmark.get() == bm.bookmarkid);
        let isCopied = mobx.computed(() => (model.copiedIndicator.get() == bm.bookmarkid)).get();
        if (isEditing) {
            return (
                <div data-bookmarkid={bm.bookmarkid} className={cn("bookmark focus-parent is-editing", {"pending-delete": model.pendingDelete.get() == bm.bookmarkid})}>
                    <div className={cn("focus-indicator", {"active": isSelected})}/>
                    <div className="bookmark-edit">
                        <div className="field">
                            <label className="label">Description (markdown)</label>
                            <div className="control">
                                <textarea className="textarea mono-font" rows={6} value={model.tempDesc.get()} onChange={this.handleDescChange}/>
                            </div>
                        </div>
                        <div className="field">
                            <label className="label">Command</label>
                            <div className="control">
                                <textarea className="textarea mono-font" rows={3} value={model.tempCmd.get()} onChange={this.handleCmdChange}/>
                            </div>
                        </div>
                        <div className="field is-grouped">
                            <div className="control">
                                <button className="button is-link" onClick={this.handleEditUpdate}>Update</button>
                            </div>
                            <div className="control">
                                <button className="button" onClick={this.handleEditCancel}>Cancel</button>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }
        return (
            <div className={cn("bookmark focus-parent", {"pending-delete": model.pendingDelete.get() == bm.bookmarkid})} onClick={this.handleClick}>
                <div className={cn("focus-indicator", {"active": isSelected})}/>
                <div className="bookmark-id-div">{bm.bookmarkid.substr(0, 8)}</div>
                <div className="bookmark-content">
                    <If condition={hasDesc}>
                        <Markdown text={markdown}/>
                    </If>
                    <CmdStrCode cmdstr={bm.cmdstr} onUse={this.handleUse} onCopy={this.clickCopy} isCopied={isCopied} fontSize="large" limitHeight={false}/>
                </div>
                <div className="bookmark-controls">
                    <div className="bookmark-control" onClick={this.handleEditClick}><i className="fa-sharp fa-solid fa-pen"/></div>
                    <div className="bookmark-control" onClick={this.handleDeleteClick}><i className="fa-sharp fa-solid fa-trash"/></div>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class BookmarksView extends React.Component<{}, {}> {
    @boundMethod
    clickHandler() : void {
        GlobalModel.bookmarksModel.closeView();
    }
    
    render() {
        let isHidden = (GlobalModel.activeMainView.get() != "bookmarks");
        let bookmarks = GlobalModel.bookmarksModel.bookmarks;
        let idx : number = 0;
        let bookmark : BookmarkType = null;
        return (
            <div className={cn("bookmarks-view", "alt-view", {"is-hidden": isHidden})}>
                <div className="close-button" onClick={this.clickHandler}><i className="fa-sharp fa-solid fa-xmark"></i></div>
                <div className="alt-title">
                    <i className="fa-sharp fa-solid fa-bookmark" style={{marginRight: 10}}/>
                    BOOKMARKS
                </div>
                <div className="bookmarks-list">
                    <For index="idx" each="bookmark" of={bookmarks}>
                        <Bookmark key={bookmark.bookmarkid} bookmark={bookmark}/>
                    </For>
                    <If condition={bookmarks.length == 0}>
                        <div className="no-bookmarks">
                            No Bookmarks.<br/>
                            Use the <i className="fa-sharp fa-solid fa-bookmark"/> icon on commands to add your first bookmark.
                        </div>
                    </If>
                </div>
                <If condition={bookmarks.length > 0}>
                    <div className="alt-help">
                        <div className="help-entry">
                            [Enter] to Use Bookmark<br/>
                            [Backspace/Delete]x2 or <i className="fa-sharp fa-solid fa-trash"/> to Delete<br/>
                            [Arrow Up]/[Arrow Down]/[PageUp]/[PageDown] to Move in List<br/>
                            [e] or <i className="fa-sharp fa-solid fa-pen"/> to Edit<br/>
                            [c] or <i className="fa-sharp fa-regular fa-copy"/> to Copy<br/>
                        </div>
                    </div>
                </If>
            </div>
        );
    }
}

export {BookmarksView};
